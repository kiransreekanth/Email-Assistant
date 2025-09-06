const OpenAI = require('openai');

class AIService {
    constructor() {
        this.openai = null;
        this.isInitialized = false;
        this.knowledgeBase = {
            // Add your company's knowledge base here
            products: {
                'email-assistant': 'AI-powered email management system that automatically processes support emails, analyzes sentiment, and generates contextual responses.',
                'support': 'Our support team is available Monday-Friday 9AM-6PM EST. For urgent issues, please mark your email as "URGENT" in the subject line.'
            },
            policies: {
                'refund': 'We offer full refunds within 30 days of purchase. Please provide your order number and reason for refund.',
                'privacy': 'We take privacy seriously and never share customer data with third parties.',
                'response_time': 'We aim to respond to all support emails within 24 hours during business days.'
            },
            commonIssues: {
                'login': 'For login issues, please try resetting your password first. If that doesn\'t work, check if your account is active.',
                'billing': 'For billing questions, please provide your account email and we\'ll review your account.',
                'technical': 'For technical issues, please include browser version, operating system, and steps to reproduce the problem.'
            }
        };
    }

    // Initialize OpenAI client
    async init() {
        try {
            if (!process.env.OPENAI_API_KEY) {
                console.log('⚠️ OpenAI API key not found in environment variables');
                return;
            }

            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });

            // Test the API connection
            await this.testConnection();
            this.isInitialized = true;
            console.log('✅ AI service initialized successfully');

        } catch (error) {
            console.error('❌ Error initializing AI service:', error);
            throw error;
        }
    }

    // Test OpenAI API connection
    async testConnection() {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Hello' }],
                max_tokens: 5
            });
            
            console.log('✅ OpenAI API connection test successful');
            return true;
        } catch (error) {
            console.error('❌ OpenAI API connection test failed:', error);
            throw new Error('OpenAI API connection failed');
        }
    }

    // Check if AI service is configured
    isConfigured() {
        return this.isInitialized && process.env.OPENAI_API_KEY;
    }

    // NEW: Summarize email content
    async summarizeEmail(subject, body) {
        if (!this.isConfigured()) {
            throw new Error('AI service not configured');
        }

        try {
            const summaryPrompt = `
Summarize this customer support email in 2-3 concise sentences. Focus on the main issue, request, or concern.

Subject: ${subject || 'No Subject'}
Body: ${body || 'No content'}

Provide a clear, concise summary that captures:
1. The main issue or request
2. Any specific details mentioned
3. The urgency level (if applicable)

Summary:`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: summaryPrompt }],
                max_tokens: 150,
                temperature: 0.3
            });

            let summary = response.choices[0]?.message?.content?.trim();
            
            // Clean up the summary
            summary = summary.replace(/^Summary:?\s*/i, '');
            
            return summary;

        } catch (error) {
            console.error('Error generating email summary:', error);
            
            // Fallback summary
            const text = `${subject || ''} ${body || ''}`.substring(0, 200);
            return `Email from customer regarding: ${subject || 'general inquiry'}. Content preview: ${text}...`;
        }
    }

    // NEW: Generate intelligent response based on email content
    async generateIntelligentResponse(subject, body, senderEmail, tone = 'professional') {
        if (!this.isConfigured()) {
            throw new Error('AI service not configured');
        }

        try {
            // First analyze the email
            const analysis = await this.analyzeEmail(subject, body);
            
            // Get relevant knowledge base context
            const knowledgeContext = this.buildKnowledgeContext(subject, body);
            
            const responsePrompt = `
You are an expert customer support representative. Generate a personalized, helpful response to this customer email.

Customer Email:
Subject: ${subject || 'No Subject'}
Body: ${body || 'No content'}
From: ${senderEmail || 'Customer'}

Email Analysis:
- Sentiment: ${analysis.sentiment}
- Priority: ${analysis.priority}
- Category: ${analysis.extractedInfo?.category || 'general'}
- Customer Emotion: ${analysis.extractedInfo?.customerEmotion || 'neutral'}

Knowledge Base Context:
${knowledgeContext}

Response Tone: ${tone}

Requirements:
- Be ${tone === 'friendly' ? 'warm and friendly' : tone === 'formal' ? 'professional and formal' : 'professional but approachable'}
- Address the specific issue mentioned
- Provide actionable solutions or next steps
- ${analysis.priority === 'urgent' ? 'Acknowledge urgency and prioritize response' : ''}
- ${analysis.sentiment === 'negative' ? 'Show empathy and apologize for any inconvenience' : ''}
- ${analysis.sentiment === 'positive' ? 'Thank them for positive feedback' : ''}
- Include relevant contact information
- Keep response focused and not too long

Generate the response email body:`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: responsePrompt }],
                max_tokens: 500,
                temperature: 0.7
            });

            let generatedResponse = response.choices[0]?.message?.content?.trim();
            
            // Clean up response formatting
            generatedResponse = generatedResponse
                .replace(/^(Dear|Hello|Hi).*?,?\s*/i, '') // Remove greetings
                .replace(/^Subject:.*$/gm, '') // Remove subject lines
                .replace(/Best regards.*$/gms, '') // Remove signatures
                .trim();

            // Add personalized greeting and signature
            const customerName = this.extractCustomerName(senderEmail);
            const greeting = tone === 'formal' ? `Dear ${customerName}` : `Hello ${customerName}`;
            const signature = tone === 'formal' 
                ? '\n\nSincerely,\nCustomer Support Team\nsupport@yourcompany.com\n(555) 123-4567'
                : '\n\nBest regards,\nThe Support Team\nsupport@yourcompany.com\nWe\'re here to help!';

            const finalResponse = `${greeting},\n\n${generatedResponse}${signature}`;

            return finalResponse;

        } catch (error) {
            console.error('Error generating intelligent response:', error);
            
            // Fallback to original method
            return this.generateResponse(subject, body, senderEmail, await this.analyzeEmail(subject, body));
        }
    }

    // Extract customer name from email
    extractCustomerName(senderEmail) {
        if (!senderEmail) return 'Customer';
        
        // Try to extract name from email prefix
        const emailPrefix = senderEmail.split('@')[0];
        
        // Common patterns: first.last, firstname.lastname, etc.
        if (emailPrefix.includes('.')) {
            const parts = emailPrefix.split('.');
            return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
        }
        
        // Just capitalize first letter
        return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }

    // Process a batch of emails
    async processEmailsBatch(emails) {
        if (!this.isConfigured()) {
            throw new Error('AI service not configured');
        }

        const processedEmails = [];

        for (const email of emails) {
            try {
                console.log(`🤖 Processing email: ${email.subject}`);
                
                // Analyze email
                const analysis = await this.analyzeEmail(email.subject, email.body);
                
                // Generate summary
                const summary = await this.summarizeEmail(email.subject, email.body);
                
                // Generate response
                const generatedResponse = await this.generateResponse(
                    email.subject, 
                    email.body, 
                    email.sender, 
                    analysis
                );

                processedEmails.push({
                    ...email,
                    analysis,
                    summary,
                    generatedResponse
                });

            } catch (error) {
                console.error(`Error processing email "${email.subject}":`, error);
                // Add email with basic analysis if AI fails
                processedEmails.push({
                    ...email,
                    analysis: {
                        sentiment: 'neutral',
                        priority: 'normal',
                        extractedInfo: { error: 'AI processing failed' }
                    },
                    summary: 'Email processing failed - manual review required',
                    generatedResponse: 'Thank you for your email. We will review your message and get back to you shortly.'
                });
            }
        }

        return processedEmails;
    }

    // Analyze email sentiment and priority
    async analyzeEmail(subject, body) {
        if (!this.isConfigured()) {
            throw new Error('AI service not configured');
        }

        try {
            const analysisPrompt = `
Analyze this customer support email and provide a JSON response with sentiment, priority, and extracted information.

Subject: ${subject || 'No Subject'}
Body: ${body || 'No content'}

Respond with valid JSON only:
{
    "sentiment": "positive|negative|neutral",
    "priority": "urgent|normal|low", 
    "extractedInfo": {
        "category": "billing|technical|general|complaint|compliment|refund|account",
        "urgencyKeywords": ["list of urgent words found"],
        "customerEmotion": "frustrated|happy|confused|angry|neutral|excited",
        "requestType": "question|complaint|compliment|request|refund|support|other",
        "keyPoints": ["main points mentioned in the email"],
        "mentionedProducts": ["any products or services mentioned"]
    }
}

Priority should be "urgent" if the email contains words like: urgent, emergency, critical, broken, not working, asap, immediately, help, issue, problem, error, bug, crash, down, refund, cancel, dispute.`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: analysisPrompt }],
                max_tokens: 400,
                temperature: 0.3
            });

            const analysisText = response.choices[0]?.message?.content?.trim();
            
            try {
                const analysis = JSON.parse(analysisText);
                return analysis;
            } catch (parseError) {
                console.error('Error parsing AI analysis response:', parseError);
                console.log('Raw response:', analysisText);
                
                // Fallback analysis based on keywords
                return this.fallbackAnalysis(subject, body);
            }

        } catch (error) {
            console.error('Error in AI email analysis:', error);
            return this.fallbackAnalysis(subject, body);
        }
    }

    // Fallback analysis when AI fails
    fallbackAnalysis(subject, body) {
        const text = `${subject} ${body}`.toLowerCase();
        
        // Check for urgent keywords
        const urgentKeywords = ['urgent', 'emergency', 'critical', 'asap', 'immediately', 'broken', 'not working', 'down', 'error', 'bug', 'crash', 'help', 'refund', 'cancel', 'dispute'];
        const foundUrgentKeywords = urgentKeywords.filter(keyword => text.includes(keyword));
        const isUrgent = foundUrgentKeywords.length > 0;
        
        // Check sentiment keywords
        const positiveKeywords = ['thank', 'great', 'excellent', 'amazing', 'love', 'perfect', 'wonderful', 'satisfied', 'happy'];
        const negativeKeywords = ['angry', 'frustrated', 'terrible', 'awful', 'hate', 'worst', 'disappointed', 'useless', 'broken', 'problem'];
        
        const positiveCount = positiveKeywords.filter(keyword => text.includes(keyword)).length;
        const negativeCount = negativeKeywords.filter(keyword => text.includes(keyword)).length;
        
        let sentiment = 'neutral';
        if (positiveCount > negativeCount) sentiment = 'positive';
        else if (negativeCount > positiveCount) sentiment = 'negative';
        
        // Determine category
        let category = 'general';
        if (text.includes('bill') || text.includes('payment') || text.includes('charge')) category = 'billing';
        else if (text.includes('login') || text.includes('password') || text.includes('account')) category = 'account';
        else if (text.includes('bug') || text.includes('error') || text.includes('not working')) category = 'technical';
        else if (text.includes('refund') || text.includes('cancel')) category = 'refund';
        else if (negativeCount > 0) category = 'complaint';
        else if (positiveCount > 0) category = 'compliment';
        
        return {
            sentiment,
            priority: isUrgent ? 'urgent' : 'normal',
            extractedInfo: {
                category,
                urgencyKeywords: foundUrgentKeywords,
                customerEmotion: negativeCount > 0 ? 'frustrated' : positiveCount > 0 ? 'happy' : 'neutral',
                requestType: text.includes('?') ? 'question' : category === 'refund' ? 'refund' : 'request',
                keyPoints: [subject || 'No specific points identified'],
                mentionedProducts: []
            }
        };
    }

    // Generate AI response to email (original method, keeping for backward compatibility)
    async generateResponse(subject, body, senderEmail, analysis) {
        if (!this.isConfigured()) {
            throw new Error('AI service not configured');
        }

        try {
            const knowledgeContext = this.buildKnowledgeContext(subject, body);
            
            const responsePrompt = `
You are a professional customer support representative. Generate a helpful, empathetic response to this customer email.

Customer Email:
Subject: ${subject || 'No Subject'}
Body: ${body || 'No content'}
From: ${senderEmail || 'Customer'}

Email Analysis:
- Sentiment: ${analysis.sentiment}
- Priority: ${analysis.priority}
- Category: ${analysis.extractedInfo?.category || 'general'}
- Customer Emotion: ${analysis.extractedInfo?.customerEmotion || 'neutral'}

Knowledge Base Context:
${knowledgeContext}

Guidelines:
- Be professional, helpful, and empathetic
- Address the customer's specific concerns
- If urgent, acknowledge the urgency
- If customer seems frustrated, be extra understanding
- Provide actionable solutions when possible
- Keep response concise but complete
- Use a warm, human tone
- End with next steps or contact information if needed

Generate a response email:`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: responsePrompt }],
                max_tokens: 400,
                temperature: 0.7
            });

            let generatedResponse = response.choices[0]?.message?.content?.trim();
            
            // Clean up response
            generatedResponse = generatedResponse
                .replace(/^Subject:.*$/gm, '') // Remove subject lines
                .replace(/^Dear.*,$/gm, '') // Remove salutations if generated
                .replace(/^Best regards,.*$/gms, '') // Remove signatures
                .trim();

            // Add professional signature
            generatedResponse += '\n\nBest regards,\nAI Customer Support\nEmail: support@yourcompany.com\nResponse Time: 24 hours';

            return generatedResponse;

        } catch (error) {
            console.error('Error generating AI response:', error);
            
            // Fallback response based on analysis
            return this.generateFallbackResponse(analysis, senderEmail);
        }
    }

    // Build knowledge context for AI
    buildKnowledgeContext(subject, body) {
        const text = `${subject} ${body}`.toLowerCase();
        const relevantKnowledge = [];

        // Check for product mentions
        Object.entries(this.knowledgeBase.products).forEach(([product, info]) => {
            if (text.includes(product)) {
                relevantKnowledge.push(`Product Info (${product}): ${info}`);
            }
        });

        // Check for policy mentions
        Object.entries(this.knowledgeBase.policies).forEach(([policy, info]) => {
            if (text.includes(policy) || text.includes(policy.replace('_', ' '))) {
                relevantKnowledge.push(`Policy (${policy}): ${info}`);
            }
        });

        // Check for common issues
        Object.entries(this.knowledgeBase.commonIssues).forEach(([issue, solution]) => {
            if (text.includes(issue)) {
                relevantKnowledge.push(`Common Issue (${issue}): ${solution}`);
            }
        });

        return relevantKnowledge.length > 0 
            ? relevantKnowledge.join('\n') 
            : 'No specific knowledge base information found for this query.';
    }

    // Generate fallback response when AI fails
    generateFallbackResponse(analysis, senderEmail) {
        const customerName = senderEmail ? senderEmail.split('@')[0] : 'Customer';
        
        let response = `Hello ${customerName},\n\nThank you for contacting our support team.`;

        if (analysis.priority === 'urgent') {
            response += ' We understand this is urgent and will prioritize your request.';
        }

        if (analysis.sentiment === 'negative') {
            response += ' We sincerely apologize for any inconvenience you may have experienced.';
        } else if (analysis.sentiment === 'positive') {
            response += ' We appreciate your positive feedback!';
        }

        response += ' We are reviewing your message and will get back to you within 24 hours with a detailed response.';

        if (analysis.priority === 'urgent') {
            response += ' For immediate assistance, you can also call our support line at (555) 123-4567.';
        }

        response += '\n\nBest regards,\nCustomer Support Team\nEmail: support@yourcompany.com';

        return response;
    }

    // Update knowledge base
    updateKnowledgeBase(category, key, value) {
        if (this.knowledgeBase[category]) {
            this.knowledgeBase[category][key] = value;
            console.log(`✅ Updated knowledge base: ${category}.${key}`);
        } else {
            console.error(`❌ Invalid knowledge base category: ${category}`);
        }
    }

    // Get knowledge base
    getKnowledgeBase() {
        return this.knowledgeBase;
    }

    // Batch process with rate limiting
    async processEmailsBatchWithRateLimit(emails, delayMs = 1000) {
        const processedEmails = [];
        
        for (let i = 0; i < emails.length; i++) {
            try {
                const email = emails[i];
                console.log(`🤖 Processing email ${i + 1}/${emails.length}: ${email.subject}`);
                
                const processed = await this.processEmailsBatch([email]);
                processedEmails.push(...processed);
                
                // Add delay between requests to avoid rate limits
                if (i < emails.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
                
            } catch (error) {
                console.error(`Error processing email ${i + 1}:`, error);
                continue;
            }
        }
        
        return processedEmails;
    }

    // Analyze email batch for insights
    async getEmailInsights(emails) {
        const insights = {
            totalEmails: emails.length,
            sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
            priorityBreakdown: { urgent: 0, normal: 0, low: 0 },
            categoryBreakdown: {},
            trends: {
                mostCommonWords: [],
                avgResponseTime: null,
                peakHours: []
            }
        };

        emails.forEach(email => {
            if (email.analysis) {
                // Count sentiments
                insights.sentimentBreakdown[email.analysis.sentiment]++;
                
                // Count priorities  
                insights.priorityBreakdown[email.analysis.priority]++;
                
                // Count categories
                const category = email.analysis.extractedInfo?.category || 'other';
                insights.categoryBreakdown[category] = (insights.categoryBreakdown[category] || 0) + 1;
            }
        });

        return insights;
    }
}

module.exports = AIService;