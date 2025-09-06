const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

// Import services
const Database = require('./database/init');
const GmailService = require('./services/gmailService');
const AIService = require('./services/aiService');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Initialize services
const db = new Database();
const gmailService = new GmailService();
const aiService = new AIService();

// =================
// MIDDLEWARE SETUP
// =================

// Security middleware with relaxed CSP for development
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.openai.com", "https://www.googleapis.com"]
        }
    }
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] // Replace with your production domain
        : ['http://localhost:3000', 'http://localhost:3001']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Add favicon route to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).send();
});

// =================
// UTILITY FUNCTIONS
// =================

// Check if services are properly configured
function isGmailConfigured() {
    return process.env.GMAIL_CLIENT_ID && 
           process.env.GMAIL_CLIENT_SECRET && 
           process.env.GMAIL_REFRESH_TOKEN;
}

function isOpenAIConfigured() {
    return process.env.OPENAI_API_KEY;
}

// =================
// API ROUTES
// =================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        services: {
            gmail: isGmailConfigured() ? 'configured' : 'not configured',
            openai: isOpenAIConfigured() ? 'configured' : 'not configured',
            database: 'available'
        }
    });
});

// Get Gmail authorization URL (for initial setup)
app.get('/api/auth/gmail', (req, res) => {
    try {
        const authUrl = gmailService.getAuthUrl();
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            res.json({ authUrl });
        } else {
            // Redirect for browser requests
            res.redirect(authUrl);
        }
    } catch (error) {
        console.error('Gmail auth URL error:', error);
        res.status(500).json({ error: 'Failed to generate auth URL: ' + error.message });
    }
});

// Handle Gmail OAuth callback
app.get('/auth/callback', async (req, res) => {
    try {
        const { code, error: authError } = req.query;
        
        if (authError) {
            return res.status(400).send(`
                <h2>Authorization Failed</h2>
                <p>Error: ${authError}</p>
                <p><a href="/api/auth/gmail">Try again</a></p>
            `);
        }

        if (!code) {
            return res.status(400).send(`
                <h2>Authorization Failed</h2>
                <p>No authorization code received</p>
                <p><a href="/api/auth/gmail">Try again</a></p>
            `);
        }

        const tokens = await gmailService.getTokens(code);
        
        res.send(`
            <html>
            <head>
                <title>Gmail Authorization Success</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                    .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0; }
                    .code { background: #f8f9fa; padding: 15px; border: 1px solid #dee2e6; border-radius: 5px; font-family: monospace; word-break: break-all; }
                    .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; margin: 10px 5px; }
                </style>
            </head>
            <body>
                <h1>✅ Gmail Authorization Successful!</h1>
                <div class="success">
                    <p><strong>Step 1:</strong> Copy the refresh token below to your .env file:</p>
                </div>
                <div class="code">
                    GMAIL_REFRESH_TOKEN=${tokens.refresh_token || 'Token not available - please try again'}
                </div>
                <div class="success">
                    <p><strong>Step 2:</strong> Restart your server after updating the .env file</p>
                    <p><strong>Step 3:</strong> Return to your dashboard and try fetching emails</p>
                </div>
                <a href="/" class="btn">Return to Dashboard</a>
                <button class="btn" onclick="window.close()">Close Window</button>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Gmail OAuth callback error:', error);
        res.status(500).send(`
            <h2>Authorization Error</h2>
            <p>Failed to process authorization: ${error.message}</p>
            <p><a href="/api/auth/gmail">Try again</a></p>
        `);
    }
});

// FIXED: Fetch and process emails manually
app.post('/api/emails/fetch', async (req, res) => {
    try {
        console.log('📧 Manual email fetch requested...');
        
        // Check configuration
        if (!isGmailConfigured()) {
            return res.status(400).json({ 
                error: 'Gmail not configured. Please set up Gmail authentication first.',
                authUrl: '/api/auth/gmail'
            });
        }

        // Fetch emails from Gmail
        console.log('Fetching emails from Gmail...');
        const emails = await gmailService.fetchSupportEmails();
        console.log(`Found ${emails.length} support emails`);

        if (emails.length === 0) {
            return res.json({ 
                message: 'No new support emails found', 
                newEmails: 0,
                emails: []
            });
        }

        // Process emails with AI analysis and response generation
        console.log('Processing emails with AI analysis...');
        const processedEmails = [];
        let processedCount = 0;
        let errorCount = 0;

        for (const email of emails) {
            try {
                console.log(`Processing: ${email.subject || 'No Subject'}`);
                
                // Basic email data
                const emailData = {
                    messageId: email.messageId || email.id || `manual_${Date.now()}_${Math.random()}`,
                    sender: email.sender || email.from || 'unknown@example.com',
                    subject: email.subject || 'No Subject', 
                    body: email.body || email.content || 'No content',
                    receivedDate: email.receivedDate || email.date || new Date().toISOString(),
                    sentiment: 'neutral',
                    priority: 'normal',
                    extractedInfo: '{}',
                    status: 'pending'
                };

                // Insert email first
                const emailId = await db.insertEmail(emailData);
                
                if (emailId) {
                    // AI processing if OpenAI is configured
                    if (isOpenAIConfigured()) {
                        try {
                            console.log(`Running AI analysis for email ${emailId}...`);
                            
                            // Analyze email
                            const analysis = await aiService.analyzeEmail(email.subject, email.body);
                            
                            // Generate summary
                            const summary = await aiService.summarizeEmail(email.subject, email.body);
                            
                            // Generate intelligent response
                            const aiResponse = await aiService.generateIntelligentResponse(
                                email.subject, 
                                email.body, 
                                email.sender || email.from
                            );

                            // Update email with AI analysis
                            await db.updateEmailAnalysis(emailId, {
                                sentiment: analysis.sentiment || 'neutral',
                                priority: analysis.priority || 'normal',
                                extractedInfo: JSON.stringify(analysis.extractedInfo || {}),
                                summary: summary
                            });

                            // Insert AI response
                            if (aiResponse) {
                                await db.insertResponse(emailId, aiResponse);
                                console.log(`✅ AI response generated for email ${emailId}`);
                            }

                            emailData.analysis = analysis;
                            emailData.summary = summary;
                            emailData.hasAiResponse = !!aiResponse;
                            
                        } catch (aiError) {
                            console.log(`AI processing failed for email ${emailId}: ${aiError.message}`);
                            emailData.hasAiResponse = false;
                        }
                    }

                    processedEmails.push({
                        id: emailId,
                        ...emailData
                    });
                    processedCount++;
                    console.log(`✅ Email saved with ID: ${emailId}`);
                } else {
                    console.log('⭐ Email already exists, skipped');
                }
            } catch (emailError) {
                console.error(`Error processing email "${email.subject}":`, emailError);
                errorCount++;
            }
        }

        console.log(`🎉 Processed ${processedCount} new emails`);
        
        res.json({
            message: `Successfully processed ${processedCount} emails` + 
                    (errorCount > 0 ? ` (${errorCount} errors)` : ''),
            newEmails: processedCount,
            errors: errorCount,
            emails: processedEmails.slice(0, 5) // Return first 5 for preview
        });

    } catch (error) {
        console.error('Error in fetch endpoint:', error);
        res.status(500).json({ 
            error: 'Failed to fetch and process emails',
            details: error.message
        });
    }
});

// FIXED: Get all processed emails with filtering  
app.get('/api/emails', async (req, res) => {
    try {
        console.log('📊 Frontend requesting emails list...');
        
        const { 
            limit = 50, 
            priority, 
            sentiment, 
            status,
            page = 1
        } = req.query;
        
        const options = {
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit)
        };
        
        // Add filters only if they have values
        if (priority) options.priority = priority;
        if (sentiment) options.sentiment = sentiment;
        if (status) options.status = status;

        // Use the Database class methods
        const emails = await db.getAllEmails(options);
        const total = await db.getEmailCount(options);
        
        console.log(`📊 Returning ${emails.length} emails to frontend`);
        console.log('📧 Sample email:', emails[0] || 'No emails found');
        
        res.json({ 
            emails: emails || [],
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ 
            error: 'Failed to fetch emails',
            details: error.message,
            emails: [], // Always return an array for frontend
            total: 0
        });
    }
});

// FIXED: Get email analytics for dashboard
app.get('/api/analytics', async (req, res) => {
    try {
        console.log('📊 Frontend requesting analytics...');
        
        const analytics = await db.getAnalytics();
        const chartData = await db.getEmailsByDate(7); // Last 7 days
        
        console.log('📊 Analytics data:', analytics);
        
        res.json({
            totalEmails: analytics.totalEmails || 0,
            urgentEmails: analytics.urgentEmails || 0, 
            processedEmails: analytics.processedEmails || 0,
            avgSentiment: analytics.avgSentiment || 0,
            sentimentDistribution: analytics.sentimentDistribution || {},
            priorityDistribution: analytics.priorityDistribution || {},
            chartData: chartData || [],
            processingRate: analytics.totalEmails > 0 ? 
                (analytics.processedEmails / analytics.totalEmails * 100).toFixed(1) : 0
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        // Return default values instead of error to keep dashboard working
        res.json({
            totalEmails: 0,
            urgentEmails: 0,
            processedEmails: 0,
            avgSentiment: 0,
            sentimentDistribution: {},
            priorityDistribution: {},
            chartData: [],
            processingRate: 0
        });
    }
});

// Get specific email by ID with full details
app.get('/api/emails/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const email = await db.getEmailById(id);
        
        if (!email) {
            return res.status(404).json({ error: 'Email not found' });
        }
        
        // Get associated responses
        const responses = await db.getResponsesByEmailId(id);
        
        res.json({
            ...email,
            responses: responses || []
        });
    } catch (error) {
        console.error('Error fetching email:', error);
        res.status(500).json({ 
            error: 'Failed to fetch email',
            details: error.message
        });
    }
});

// NEW: Generate AI summary for specific email
app.post('/api/emails/:id/summarize', async (req, res) => {
    try {
        const { id } = req.params;
        const email = await db.getEmailById(id);
        
        if (!email) {
            return res.status(404).json({ error: 'Email not found' });
        }

        if (!isOpenAIConfigured()) {
            return res.status(400).json({ 
                error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your environment variables.'
            });
        }

        console.log(`Generating AI summary for email ${id}...`);
        
        const summary = await aiService.summarizeEmail(email.subject, email.body);
        
        // Update the summary in database
        await db.updateEmailSummary(id, summary);

        res.json({ 
            message: 'Email summary generated successfully',
            summary: summary
        });
        
    } catch (error) {
        console.error('Error generating summary:', error);
        res.status(500).json({ 
            error: 'Failed to generate summary',
            details: error.message
        });
    }
});

// NEW: Generate AI response for specific email
app.post('/api/emails/:id/generate-response', async (req, res) => {
    try {
        const { id } = req.params;
        const { tone = 'professional' } = req.body;
        
        const email = await db.getEmailById(id);
        
        if (!email) {
            return res.status(404).json({ error: 'Email not found' });
        }

        if (!isOpenAIConfigured()) {
            return res.status(400).json({ 
                error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your environment variables.'
            });
        }

        console.log(`Generating AI response for email ${id} with tone: ${tone}...`);
        
        const aiResponse = await aiService.generateIntelligentResponse(
            email.subject, 
            email.body, 
            email.sender,
            tone
        );

        // Insert new response in database (replace existing AI response)
        await db.insertResponse(id, aiResponse);

        res.json({ 
            message: 'AI response generated successfully',
            response: aiResponse,
            tone: tone
        });
        
    } catch (error) {
        console.error('Error generating AI response:', error);
        res.status(500).json({ 
            error: 'Failed to generate AI response',
            details: error.message
        });
    }
});

// Update email status
app.put('/api/emails/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['pending', 'resolved', 'ignored', 'responded'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        
        await db.updateEmailStatus(id, status);
        res.json({ message: 'Email status updated successfully' });
    } catch (error) {
        console.error('Error updating email status:', error);
        res.status(500).json({ 
            error: 'Failed to update email status',
            details: error.message
        });
    }
});

// Send response email
app.post('/api/emails/:id/send-response', async (req, res) => {
    try {
        const { id } = req.params;
        const { responseText, recipientEmail, subject } = req.body;

        if (!responseText) {
            return res.status(400).json({ error: 'Response text is required' });
        }

        // Get email details if not provided
        let email;
        if (!recipientEmail || !subject) {
            email = await db.getEmailById(id);
            if (!email) {
                return res.status(404).json({ error: 'Email not found' });
            }
        }

        const finalRecipient = recipientEmail || email.sender;
        const finalSubject = subject || `Re: ${email.subject}`;

        if (!isGmailConfigured()) {
            return res.status(400).json({ 
                error: 'Gmail not configured. Please set up Gmail authentication first.'
            });
        }

        // Send email via Gmail
        await gmailService.sendResponse(finalRecipient, finalSubject, responseText, id);
        
        // Update response as sent
        await db.markResponseAsSent(id);
        
        // Update email status to responded
        await db.updateEmailStatus(id, 'responded');

        res.json({ 
            message: 'Response sent successfully',
            recipient: finalRecipient,
            subject: finalSubject
        });
    } catch (error) {
        console.error('Error sending response:', error);
        res.status(500).json({ 
            error: 'Failed to send response',
            details: error.message
        });
    }
});

// Generate new AI response for email (backward compatibility)
app.post('/api/emails/:id/regenerate-response', async (req, res) => {
    try {
        const { id } = req.params;
        const email = await db.getEmailById(id);
        
        if (!email) {
            return res.status(404).json({ error: 'Email not found' });
        }

        if (!isOpenAIConfigured()) {
            return res.status(400).json({ 
                error: 'OpenAI API key not configured'
            });
        }

        // Re-analyze and generate new response
        console.log(`Regenerating response for email ${id}`);
        
        const analysis = await aiService.analyzeEmail(email.subject, email.body);
        const newResponse = await aiService.generateResponse(
            email.subject, 
            email.body, 
            email.sender, 
            analysis
        );

        // Update response in database
        await db.insertResponse(id, newResponse);

        res.json({ 
            message: 'New response generated successfully',
            response: newResponse,
            analysis 
        });
    } catch (error) {
        console.error('Error regenerating response:', error);
        res.status(500).json({ 
            error: 'Failed to regenerate response',
            details: error.message
        });
    }
});

// DEBUG: Test database directly
app.get('/api/debug/test-db', async (req, res) => {
    try {
        console.log('🔍 Testing database connection...');
        
        // Test connection
        const connectionTest = await db.testConnection();
        console.log('Database connection test:', connectionTest);
        
        // Count emails
        const count = await db.getEmailCount();
        console.log('Total emails in database:', count);
        
        // Get few emails
        const emails = await db.getAllEmails({ limit: 5 });
        console.log('Sample emails:', emails);
        
        res.json({
            connectionTest,
            totalEmails: count,
            sampleEmails: emails,
            databasePath: db.dbPath
        });
        
    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack
        });
    }
});

// DEBUG: Manual test email insertion
app.post('/api/debug/insert-test-email', async (req, res) => {
    try {
        console.log('🔍 Inserting test email...');
        
        const testEmailData = {
            messageId: `test_${Date.now()}`,
            sender: 'test@example.com',
            subject: 'Test Email Subject',
            body: 'This is a test email body for testing purposes.',
            receivedDate: new Date().toISOString(),
            sentiment: 'neutral',
            priority: 'normal',
            extractedInfo: '{}',
            status: 'pending'
        };
        
        const emailId = await db.insertEmail(testEmailData);
        console.log('Test email inserted with ID:', emailId);
        
        // Generate AI summary and response if OpenAI is configured
        if (emailId && isOpenAIConfigured()) {
            try {
                const summary = await aiService.summarizeEmail(testEmailData.subject, testEmailData.body);
                const response = await aiService.generateIntelligentResponse(
                    testEmailData.subject, 
                    testEmailData.body, 
                    testEmailData.sender
                );
                
                await db.updateEmailSummary(emailId, summary);
                await db.insertResponse(emailId, response);
                
                console.log('AI processing completed for test email');
            } catch (aiError) {
                console.log('AI processing failed:', aiError.message);
            }
        }
        
        // Verify it was saved
        const savedEmail = await db.getEmailById(emailId);
        console.log('Retrieved email:', savedEmail);
        
        res.json({
            message: 'Test email inserted successfully',
            emailId,
            savedEmail
        });
        
    } catch (error) {
        console.error('Test email insertion error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack
        });
    }
});

// =================
// FRONTEND ROUTES
// =================

// Serve main dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle any other routes (SPA fallback)
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found' });
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// =================
// AUTOMATED EMAIL PROCESSING
// =================

// Schedule automatic email fetching every 15 minutes
const scheduleAutomaticProcessing = () => {
    console.log('⏰ Scheduling automatic email processing every 15 minutes...');
    
    cron.schedule('*/15 * * * *', async () => {
        try {
            console.log('🔄 Running scheduled email fetch...');
            
            if (!isGmailConfigured()) {
                console.log('⚠️  Skipping scheduled fetch - Gmail not configured');
                return;
            }
            
            const emails = await gmailService.fetchSupportEmails();
            
            if (emails.length > 0) {
                console.log(`📧 Processing ${emails.length} new emails in background...`);
                
                let successCount = 0;
                
                for (const email of emails) {
                    try {
                        const emailData = {
                            messageId: email.messageId || email.id,
                            sender: email.sender || email.from,
                            subject: email.subject,
                            body: email.body || email.content,
                            receivedDate: email.receivedDate || email.date || new Date().toISOString(),
                            sentiment: 'neutral',
                            priority: 'normal',
                            extractedInfo: '{}',
                            status: 'pending'
                        };

                        const emailId = await db.insertEmail(emailData);

                        if (emailId && isOpenAIConfigured()) {
                            try {
                                // AI processing
                                const analysis = await aiService.analyzeEmail(email.subject, email.body);
                                const summary = await aiService.summarizeEmail(email.subject, email.body);
                                const aiResponse = await aiService.generateIntelligentResponse(
                                    email.subject, 
                                    email.body, 
                                    email.sender || email.from
                                );

                                // Update database with AI results
                                await db.updateEmailAnalysis(emailId, {
                                    sentiment: analysis.sentiment || 'neutral',
                                    priority: analysis.priority || 'normal',
                                    extractedInfo: JSON.stringify(analysis.extractedInfo || {}),
                                    summary: summary
                                });

                                if (aiResponse) {
                                    await db.insertResponse(emailId, aiResponse);

                                    // Auto-send responses for non-urgent emails if configured
                                    if (process.env.AUTO_SEND_RESPONSES === 'true' && 
                                        analysis.priority !== 'urgent') {
                                        try {
                                            await gmailService.sendResponse(
                                                email.sender || email.from,
                                                `Re: ${email.subject}`,
                                                aiResponse,
                                                email.messageId || email.id
                                            );
                                            await db.markResponseAsSent(emailId);
                                            await db.updateEmailStatus(emailId, 'responded');
                                            console.log(`✅ Auto-sent response for: ${email.subject}`);
                                        } catch (sendError) {
                                            console.error('Error auto-sending response:', sendError);
                                        }
                                    }
                                }
                            } catch (aiError) {
                                console.error('AI processing failed during scheduled run:', aiError);
                            }
                        }

                        if (emailId) successCount++;
                    } catch (error) {
                        console.error('Error processing scheduled email:', error);
                    }
                }
                
                console.log(`✅ Scheduled processing completed: ${successCount}/${emails.length} emails processed successfully`);
            } else {
                console.log('🔭 No new emails found during scheduled fetch');
            }
        } catch (error) {
            console.error('❌ Error in scheduled email processing:', error);
        }
    });
};

// =================
// ERROR HANDLING
// =================

// Global error handler
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// =================
// SERVER STARTUP
// =================

// Initialize services and start server
async function startServer() {
    try {
        console.log('🚀 Starting AI Email Assistant...\n');
        
        // Initialize database
        console.log('📊 Initializing database...');
        await db.init();
        console.log('✅ Database initialized successfully');
        
        // Test service configurations
        console.log('\n🔧 Checking service configurations:');
        
        if (isGmailConfigured()) {
            console.log('✅ Gmail API configured');
            try {
                // Test Gmail connection
                await gmailService.testConnection();
                console.log('✅ Gmail connection tested successfully');
            } catch (gmailError) {
                console.log(`⚠️  Gmail connection test failed: ${gmailError.message}`);
            }
        } else {
            console.log('❌ Gmail API not configured - set up via dashboard');
        }
        
        if (isOpenAIConfigured()) {
            console.log('✅ OpenAI API configured');
            try {
                // Initialize AI service
                await aiService.init();
                console.log('✅ AI service initialized');
            } catch (aiError) {
                console.log(`⚠️  AI service initialization warning: ${aiError.message}`);
            }
        } else {
            console.log('❌ OpenAI API not configured - add OPENAI_API_KEY to .env');
        }
        
        // Start scheduled processing if Gmail is configured
        if (isGmailConfigured()) {
            scheduleAutomaticProcessing();
        } else {
            console.log('⚠️  Automatic processing disabled - configure Gmail first');
        }
        
        // Start server
        app.listen(PORT, () => {
            console.log(`
🎉 AI-Powered Email Assistant Server Started Successfully!

📊 Dashboard:      http://localhost:${PORT}
🔧 API Base:       http://localhost:${PORT}/api  
💚 Health Check:   http://localhost:${PORT}/api/health
🔑 Gmail Setup:    http://localhost:${PORT}/api/auth/gmail
🔍 Debug DB:       http://localhost:${PORT}/api/debug/test-db

🔍 Next Steps:
${!isGmailConfigured() ? '❌ 1. Set up Gmail authentication via the dashboard' : '✅ 1. Gmail configured'}
${!isOpenAIConfigured() ? '❌ 2. Add OPENAI_API_KEY to your .env file' : '✅ 2. OpenAI configured'}
${(!isGmailConfigured() || !isOpenAIConfigured()) ? '❌ 3. Restart server after configuration' : '✅ 3. All services ready!'}

⚡ Features:
- 🤖 AI-powered email analysis and response generation  
- 📧 Gmail integration with OAuth2
- 📊 Real-time dashboard with analytics
- ⏰ Automatic processing every 15 minutes
- 🎯 Priority classification and sentiment analysis
- 📝 AI summarization and intelligent responses
- 💾 SQLite database (no setup required)

${process.env.AUTO_SEND_RESPONSES === 'true' ? '🚨 Auto-send responses: ENABLED' : '⏸️  Auto-send responses: DISABLED'}
            `);
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\n🔄 Received ${signal}, gracefully shutting down...`);
    
    try {
        await db.close();
        console.log('✅ Database closed successfully');
    } catch (error) {
        console.error('❌ Error closing database:', error);
    }
    
    console.log('👋 Server shutdown complete');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
startServer();

module.exports = app;