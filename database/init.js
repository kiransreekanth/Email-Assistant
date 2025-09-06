const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../data/emails.db');
        
        // Ensure data directory exists
        const fs = require('fs');
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    // Initialize database connection and create tables
    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    reject(err);
                    return;
                }
                
                console.log('✅ Connected to SQLite database');
                this.createTables()
                    .then(() => {
                        console.log('✅ Database tables created/verified');
                        resolve();
                    })
                    .catch(reject);
            });
        });
    }

    // Create database tables
    async createTables() {
        const createEmailsTable = `
            CREATE TABLE IF NOT EXISTS emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                messageId TEXT UNIQUE,
                sender TEXT NOT NULL,
                subject TEXT,
                body TEXT,
                receivedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                sentiment TEXT DEFAULT 'neutral',
                priority TEXT DEFAULT 'normal',
                extractedInfo TEXT,
                summary TEXT,
                status TEXT DEFAULT 'pending',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createResponsesTable = `
            CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emailId INTEGER,
                responseText TEXT NOT NULL,
                tone TEXT DEFAULT 'professional',
                isSent BOOLEAN DEFAULT 0,
                sentAt DATETIME NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (emailId) REFERENCES emails (id)
            )
        `;

        const createIndexes = [
            'CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender)',
            'CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status)',
            'CREATE INDEX IF NOT EXISTS idx_emails_priority ON emails(priority)',
            'CREATE INDEX IF NOT EXISTS idx_emails_sentiment ON emails(sentiment)',
            'CREATE INDEX IF NOT EXISTS idx_emails_received_date ON emails(receivedDate)',
            'CREATE INDEX IF NOT EXISTS idx_responses_email_id ON responses(emailId)'
        ];

        // Check if summary column exists and add it if not
        const addSummaryColumn = `
            PRAGMA table_info(emails);
        `;

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Create tables
                this.db.run(createEmailsTable, (err) => {
                    if (err) {
                        console.error('Error creating emails table:', err);
                        reject(err);
                        return;
                    }
                });

                this.db.run(createResponsesTable, (err) => {
                    if (err) {
                        console.error('Error creating responses table:', err);
                        reject(err);
                        return;
                    }
                });

                // Check if we need to add summary column to existing tables
                this.db.all(addSummaryColumn, (err, rows) => {
                    if (err) {
                        console.error('Error checking table structure:', err);
                    } else {
                        const hasSummary = rows.some(row => row.name === 'summary');
                        if (!hasSummary) {
                            console.log('Adding summary column to emails table...');
                            this.db.run('ALTER TABLE emails ADD COLUMN summary TEXT', (alterErr) => {
                                if (alterErr && !alterErr.message.includes('duplicate column')) {
                                    console.error('Error adding summary column:', alterErr);
                                } else {
                                    console.log('✅ Summary column added successfully');
                                }
                            });
                        }
                        
                        // Check for tone column in responses table
                        this.db.all('PRAGMA table_info(responses)', (err2, responseRows) => {
                            if (!err2) {
                                const hasTone = responseRows.some(row => row.name === 'tone');
                                if (!hasTone) {
                                    console.log('Adding tone column to responses table...');
                                    this.db.run('ALTER TABLE responses ADD COLUMN tone TEXT DEFAULT "professional"', (alterErr2) => {
                                        if (alterErr2 && !alterErr2.message.includes('duplicate column')) {
                                            console.error('Error adding tone column:', alterErr2);
                                        } else {
                                            console.log('✅ Tone column added successfully');
                                        }
                                    });
                                }
                            }
                        });
                    }
                });

                // Create indexes
                createIndexes.forEach(indexSQL => {
                    this.db.run(indexSQL, (err) => {
                        if (err) {
                            console.error('Error creating index:', err);
                        }
                    });
                });

                resolve();
            });
        });
    }

    // Insert new email
    async insertEmail(emailData) {
        const sql = `
            INSERT INTO emails (messageId, sender, subject, body, receivedDate, sentiment, priority, extractedInfo, summary, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const params = [
            emailData.messageId || null,
            emailData.sender,
            emailData.subject || '',
            emailData.body || '',
            emailData.receivedDate || new Date().toISOString(),
            emailData.sentiment || 'neutral',
            emailData.priority || 'normal',
            emailData.extractedInfo || '{}',
            emailData.summary || null,
            emailData.status || 'pending'
        ];

        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                        // Email already exists, return null instead of error
                        resolve(null);
                        return;
                    }
                    reject(err);
                    return;
                }
                resolve(this.lastID);
            });
        });
    }

    // Insert response for email
    async insertResponse(emailId, responseText, tone = 'professional') {
        const sql = `
            INSERT INTO responses (emailId, responseText, tone)
            VALUES (?, ?, ?)
        `;

        return new Promise((resolve, reject) => {
            this.db.run(sql, [emailId, responseText, tone], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.lastID);
            });
        });
    }

    // Update email summary
    async updateEmailSummary(id, summary) {
        const sql = `
            UPDATE emails 
            SET summary = ?, updatedAt = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;

        return new Promise((resolve, reject) => {
            this.db.run(sql, [summary, id], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.changes);
            });
        });
    }

    // Update email analysis results
    async updateEmailAnalysis(id, analysisData) {
        const sql = `
            UPDATE emails 
            SET sentiment = ?, priority = ?, extractedInfo = ?, summary = ?, updatedAt = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;

        const params = [
            analysisData.sentiment || 'neutral',
            analysisData.priority || 'normal',
            analysisData.extractedInfo || '{}',
            analysisData.summary || null,
            id
        ];

        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.changes);
            });
        });
    }

    // Get all emails with optional filtering
    async getAllEmails(options = {}) {
        let sql = `
            SELECT 
                e.*,
                r.responseText,
                r.tone,
                r.isSent,
                r.sentAt
            FROM emails e
            LEFT JOIN responses r ON e.id = r.emailId
            WHERE 1=1
        `;
        
        const params = [];
        
        if (options.priority) {
            sql += ' AND e.priority = ?';
            params.push(options.priority);
        }
        
        if (options.sentiment) {
            sql += ' AND e.sentiment = ?';
            params.push(options.sentiment);
        }
        
        if (options.status) {
            sql += ' AND e.status = ?';
            params.push(options.status);
        }
        
        sql += ' ORDER BY e.receivedDate DESC';
        
        if (options.limit) {
            sql += ' LIMIT ?';
            params.push(options.limit);
        }
        
        if (options.offset) {
            sql += ' OFFSET ?';
            params.push(options.offset);
        }

        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows || []);
            });
        });
    }

    // Get email count with filtering
    async getEmailCount(options = {}) {
        let sql = 'SELECT COUNT(*) as count FROM emails WHERE 1=1';
        const params = [];
        
        if (options.priority) {
            sql += ' AND priority = ?';
            params.push(options.priority);
        }
        
        if (options.sentiment) {
            sql += ' AND sentiment = ?';
            params.push(options.sentiment);
        }
        
        if (options.status) {
            sql += ' AND status = ?';
            params.push(options.status);
        }

        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? row.count : 0);
            });
        });
    }

    // Get email by ID
    async getEmailById(id) {
        const sql = `
            SELECT 
                e.*,
                r.responseText,
                r.tone,
                r.isSent,
                r.sentAt
            FROM emails e
            LEFT JOIN responses r ON e.id = r.emailId
            WHERE e.id = ?
        `;

        return new Promise((resolve, reject) => {
            this.db.get(sql, [id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row || null);
            });
        });
    }

    // Get responses by email ID
    async getResponsesByEmailId(emailId) {
        const sql = `
            SELECT * FROM responses 
            WHERE emailId = ? 
            ORDER BY createdAt DESC
        `;

        return new Promise((resolve, reject) => {
            this.db.all(sql, [emailId], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows || []);
            });
        });
    }

    // Update email status
    async updateEmailStatus(id, status) {
        const sql = `
            UPDATE emails 
            SET status = ?, updatedAt = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;

        return new Promise((resolve, reject) => {
            this.db.run(sql, [status, id], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.changes);
            });
        });
    }

    // Mark response as sent
    async markResponseAsSent(emailId) {
        const sql = `
            UPDATE responses 
            SET isSent = 1, sentAt = CURRENT_TIMESTAMP 
            WHERE emailId = ? AND isSent = 0
        `;

        return new Promise((resolve, reject) => {
            this.db.run(sql, [emailId], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.changes);
            });
        });
    }

    // Get analytics data
    async getAnalytics() {
        const queries = {
            total: 'SELECT COUNT(*) as count FROM emails',
            urgent: 'SELECT COUNT(*) as count FROM emails WHERE priority = "urgent"',
            processed: 'SELECT COUNT(*) as count FROM emails WHERE status != "pending"',
            avgSentiment: `
                SELECT AVG(
                    CASE 
                        WHEN sentiment = 'positive' THEN 1
                        WHEN sentiment = 'neutral' THEN 0  
                        WHEN sentiment = 'negative' THEN -1
                        ELSE 0
                    END
                ) as avg FROM emails
            `,
            sentimentDist: `
                SELECT sentiment, COUNT(*) as count 
                FROM emails 
                GROUP BY sentiment
            `,
            priorityDist: `
                SELECT priority, COUNT(*) as count 
                FROM emails 
                GROUP BY priority
            `
        };

        const results = {};

        for (const [key, query] of Object.entries(queries)) {
            try {
                if (key === 'sentimentDist' || key === 'priorityDist') {
                    results[key] = await new Promise((resolve, reject) => {
                        this.db.all(query, (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows || []);
                        });
                    });
                } else {
                    const row = await new Promise((resolve, reject) => {
                        this.db.get(query, (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    results[key] = row ? (row.count || row.avg || 0) : 0;
                }
            } catch (error) {
                console.error(`Error in analytics query ${key}:`, error);
                results[key] = key.endsWith('Dist') ? [] : 0;
            }
        }

        return {
            totalEmails: results.total || 0,
            urgentEmails: results.urgent || 0,
            processedEmails: results.processed || 0,
            avgSentiment: results.avgSentiment || 0,
            sentimentDistribution: this.arrayToObject(results.sentimentDist, 'sentiment', 'count'),
            priorityDistribution: this.arrayToObject(results.priorityDist, 'priority', 'count')
        };
    }

    // Get emails by date for charts
    async getEmailsByDate(days = 7) {
        const sql = `
            SELECT 
                DATE(receivedDate) as date,
                COUNT(*) as count
            FROM emails 
            WHERE receivedDate >= DATE('now', '-${days} days')
            GROUP BY DATE(receivedDate)
            ORDER BY date ASC
        `;

        return new Promise((resolve, reject) => {
            this.db.all(sql, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows || []);
            });
        });
    }

    // Helper function to convert array to object
    arrayToObject(array, keyField, valueField) {
        const obj = {};
        if (Array.isArray(array)) {
            array.forEach(item => {
                obj[item[keyField]] = item[valueField];
            });
        }
        return obj;
    }

    // Test database connection
    async testConnection() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT 1 as test', (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.test === 1);
                }
            });
        });
    }

    // Close database connection
    async close() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log('✅ Database connection closed');
                        resolve();
                    }
                });
            });
        }
        return Promise.resolve();
    }

    // Clean up old emails (optional maintenance method)
    async cleanupOldEmails(daysToKeep = 30) {
        const sql = `
            DELETE FROM emails 
            WHERE receivedDate < DATE('now', '-${daysToKeep} days')
        `;

        return new Promise((resolve, reject) => {
            this.db.run(sql, function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                console.log(`🧹 Cleaned up ${this.changes} old emails`);
                resolve(this.changes);
            });
        });
    }

    // Get emails with summaries
    async getEmailsWithSummaries(options = {}) {
        let sql = `
            SELECT 
                e.id,
                e.sender,
                e.subject,
                e.summary,
                e.sentiment,
                e.priority,
                e.status,
                e.receivedDate,
                r.responseText,
                r.tone,
                r.isSent
            FROM emails e
            LEFT JOIN responses r ON e.id = r.emailId
            WHERE e.summary IS NOT NULL
        `;
        
        const params = [];
        
        if (options.priority) {
            sql += ' AND e.priority = ?';
            params.push(options.priority);
        }
        
        if (options.sentiment) {
            sql += ' AND e.sentiment = ?';
            params.push(options.sentiment);
        }
        
        if (options.status) {
            sql += ' AND e.status = ?';
            params.push(options.status);
        }
        
        sql += ' ORDER BY e.receivedDate DESC';
        
        if (options.limit) {
            sql += ' LIMIT ?';
            params.push(options.limit);
        }

        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows || []);
            });
        });
    }
}

module.exports = Database;