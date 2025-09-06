const { google } = require('googleapis');
const { OAuth2 } = google.auth;

class GmailService {
    constructor() {
        this.oauth2Client = null;
        this.gmail = null;
        this.isInitialized = false;
        this.init();
    }

    init() {
        try {
            if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
                console.log('⚠️  Gmail OAuth credentials not found in environment variables');
                return;
            }

            this.oauth2Client = new OAuth2(
                process.env.GMAIL_CLIENT_ID,
                process.env.GMAIL_CLIENT_SECRET,
                process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/auth/callback'
            );

            // Set refresh token if available
            if (process.env.GMAIL_REFRESH_TOKEN) {
                this.oauth2Client.setCredentials({
                    refresh_token: process.env.GMAIL_REFRESH_TOKEN
                });
                
                this.gmail = google.gmail({ 
                    version: 'v1', 
                    auth: this.oauth2Client 
                });
                
                this.isInitialized = true;
                console.log('✅ Gmail service initialized with refresh token');
            }

        } catch (error) {
            console.error('❌ Error initializing Gmail service:', error);
        }
    }

    // Check if Gmail is properly configured
    isConfigured() {
        return this.isInitialized && 
               process.env.GMAIL_CLIENT_ID && 
               process.env.GMAIL_CLIENT_SECRET && 
               process.env.GMAIL_REFRESH_TOKEN;
    }

    // Get authorization URL for OAuth setup
    getAuthUrl() {
        if (!this.oauth2Client) {
            throw new Error('OAuth client not initialized. Check your Gmail credentials.');
        }

        const scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify'
        ];

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent' // Force consent screen to get refresh token
        });
    }

    // Exchange authorization code for tokens
    async getTokens(code) {
        if (!this.oauth2Client) {
            throw new Error('OAuth client not initialized');
        }

        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);

            // Initialize Gmail API with new tokens
            this.gmail = google.gmail({ 
                version: 'v1', 
                auth: this.oauth2Client 
            });
            
            this.isInitialized = true;
            
            return tokens;
        } catch (error) {
            console.error('Error getting tokens:', error);
            throw new Error('Failed to exchange authorization code for tokens');
        }
    }

    // Test Gmail API connection
    async testConnection() {
        if (!this.isConfigured()) {
            throw new Error('Gmail service not configured');
        }

        try {
            const response = await this.gmail.users.getProfile({
                userId: 'me'
            });
            
            console.log(`✅ Gmail connection test successful for: ${response.data.emailAddress}`);
            return true;
        } catch (error) {
            console.error('❌ Gmail connection test failed:', error);
            throw error;
        }
    }

    // Fetch support emails from Gmail
    async fetchSupportEmails(maxResults = 10) {
        if (!this.isConfigured()) {
            throw new Error('Gmail service not configured. Please authenticate first.');
        }

        try {
            console.log('📧 Fetching emails from Gmail...');

            // Search for unread emails (you can customize this query)
            const query = 'is:unread'; // Modify this query based on your needs
            
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: maxResults
            });

            const messages = response.data.messages || [];
            console.log(`Found ${messages.length} messages matching criteria`);

            if (messages.length === 0) {
                return [];
            }

            // Fetch full message details
            const emails = [];
            for (const message of messages) {
                try {
                    const fullMessage = await this.gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'full'
                    });

                    const email = this.parseEmailMessage(fullMessage.data);
                    if (email) {
                        emails.push(email);
                        
                        // Mark as read (optional)
                        await this.markAsRead(message.id);
                    }
                } catch (messageError) {
                    console.error(`Error fetching message ${message.id}:`, messageError);
                    continue;
                }
            }

            console.log(`✅ Successfully processed ${emails.length} emails`);
            return emails;

        } catch (error) {
            console.error('❌ Error fetching emails:', error);
            throw new Error(`Failed to fetch emails: ${error.message}`);
        }
    }

    // Parse Gmail message into our email format
    parseEmailMessage(message) {
        try {
            const headers = message.payload.headers || [];
            const getHeader = (name) => {
                const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
                return header ? header.value : '';
            };

            // Extract email body
            let body = '';
            if (message.payload.body && message.payload.body.data) {
                body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
            } else if (message.payload.parts) {
                // Handle multipart messages
                for (const part of message.payload.parts) {
                    if (part.mimeType === 'text/plain' && part.body.data) {
                        body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                        break;
                    }
                }
                // Fallback to HTML content if no plain text
                if (!body) {
                    for (const part of message.payload.parts) {
                        if (part.mimeType === 'text/html' && part.body.data) {
                            body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                            // Strip HTML tags for plain text (basic)
                            body = body.replace(/<[^>]*>/g, '').trim();
                            break;
                        }
                    }
                }
            }

            const email = {
                messageId: message.id,
                threadId: message.threadId,
                sender: getHeader('From'),
                subject: getHeader('Subject'),
                body: body.trim(),
                receivedDate: new Date(parseInt(message.internalDate)),
                labels: message.labelIds || []
            };

            // Clean up sender email (extract email from "Name <email>" format)
            if (email.sender) {
                const emailMatch = email.sender.match(/<(.+)>/);
                if (emailMatch) {
                    email.senderEmail = emailMatch[1];
                    email.senderName = email.sender.replace(/<.+>/, '').trim();
                } else {
                    email.senderEmail = email.sender;
                    email.senderName = email.sender;
                }
            }

            return email;

        } catch (error) {
            console.error('Error parsing email message:', error);
            return null;
        }
    }

    // Mark email as read
    async markAsRead(messageId) {
        try {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['UNREAD']
                }
            });
        } catch (error) {
            console.error(`Error marking message ${messageId} as read:`, error);
        }
    }

    // Send response email
    async sendResponse(recipientEmail, subject, responseText, originalMessageId = null) {
        if (!this.isConfigured()) {
            throw new Error('Gmail service not configured');
        }

        try {
            console.log(`📤 Sending response to: ${recipientEmail}`);

            // Create email message
            const emailLines = [
                `To: ${recipientEmail}`,
                `Subject: ${subject}`,
                'Content-Type: text/plain; charset=utf-8',
                '',
                responseText
            ];

            const email = emailLines.join('\r\n');
            const encodedEmail = Buffer.from(email).toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const response = await this.gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedEmail
                }
            });

            console.log(`✅ Email sent successfully. Message ID: ${response.data.id}`);
            return response.data;

        } catch (error) {
            console.error('❌ Error sending email:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    // Get user profile
    async getUserProfile() {
        if (!this.isConfigured()) {
            throw new Error('Gmail service not configured');
        }

        try {
            const response = await this.gmail.users.getProfile({
                userId: 'me'
            });
            return response.data;
        } catch (error) {
            console.error('Error getting user profile:', error);
            throw error;
        }
    }

    // Search emails with custom query
    async searchEmails(query, maxResults = 50) {
        if (!this.isConfigured()) {
            throw new Error('Gmail service not configured');
        }

        try {
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: maxResults
            });

            return response.data.messages || [];
        } catch (error) {
            console.error('Error searching emails:', error);
            throw error;
        }
    }

    // Refresh access token
    async refreshAccessToken() {
        if (!this.oauth2Client) {
            throw new Error('OAuth client not initialized');
        }

        try {
            const { credentials } = await this.oauth2Client.refreshAccessToken();
            this.oauth2Client.setCredentials(credentials);
            console.log('✅ Access token refreshed successfully');
            return credentials;
        } catch (error) {
            console.error('❌ Error refreshing access token:', error);
            throw error;
        }
    }
}

module.exports = GmailService;