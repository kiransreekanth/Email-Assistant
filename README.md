# 🤖 AI-Powered Email Assistant

An intelligent email management system that automatically processes support emails, analyzes sentiment, prioritizes messages, and generates contextual responses using AI.

## 🚀 Features

- **Email Retrieval**: Automatically fetches support emails from Gmail
- **AI Analysis**: Sentiment analysis and priority classification
- **Smart Responses**: Context-aware AI-generated responses using OpenAI GPT-4
- **Priority Queue**: Urgent emails processed first
- **Dashboard**: Real-time analytics and email management
- **Automated Processing**: Scheduled email fetching every 15 minutes
- **RAG Implementation**: Knowledge base integration for better responses

## 🛠 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite (no setup required)
- **AI/ML**: OpenAI GPT-4 API
- **Email**: Gmail API
- **Frontend**: Vanilla HTML/CSS/JavaScript with Chart.js
- **Scheduling**: Node-cron for automated processing

## 📋 Prerequisites

1. **Node.js** (v14 or higher)
2. **OpenAI API Key** - Get from [OpenAI Platform](https://platform.openai.com/api-keys)
3. **Gmail API Credentials** - Follow setup below
4. **Basic terminal/command prompt knowledge**

## 🔧 Installation & Setup

### Step 1: Project Setup
```bash
# Create project directory
mkdir ai-email-assistant
cd ai-email-assistant

# Create backend directory
mkdir backend
cd backend

# Copy all the provided files into their respective folders
# (package.json, server.js, .env, etc.)
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Gmail API Setup

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Create a new project** or select existing one
3. **Enable Gmail API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API" and enable it
4. **Create Credentials**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add redirect URI: `http://localhost:3001/auth/callback`
5. **Download credentials** and note:
   - Client ID
   - Client Secret

### Step 4: Configure Environment Variables

Edit the `.env` file with your credentials:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# Gmail API Configuration
GMAIL_CLIENT_ID=your-gmail-client-id-here
GMAIL_CLIENT_SECRET=your-gmail-client-secret-here
GMAIL_REDIRECT_URI=http://localhost:3001/auth/callback
GMAIL_REFRESH_TOKEN=your-refresh-token-here

# Server Configuration
PORT=3001
NODE_ENV=development
```

### Step 5: Get Gmail Refresh Token

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Visit authorization URL**:
   - Go to: http://localhost:3001/api/auth/gmail
   - Or click "Setup Gmail Auth" in the dashboard

3. **Complete OAuth flow**:
   - Sign in with your Gmail account
   - Grant permissions
   - Copy the refresh token from the callback page

4. **Update .env file** with the refresh token

5. **Restart the server**:
   ```bash
   # Press Ctrl+C to stop, then restart
   npm start
   ```

### Step 6: Test the System

1. **Open dashboard**: http://localhost:3001
2. **Click "Fetch New Emails"** to test email retrieval
3. **Check the analytics** and email processing

## 📁 Project Structure

```
backend/
├── package.json              # Dependencies
├── .env                      # Configuration (EDIT THIS)
├── server.js                 # Main server
├── database/
│   └── init.js              # Database operations
├── services/
│   ├── gmailService.js      # Gmail integration
│   └── aiService.js         # AI processing
└── public/
    └── index.html           # Dashboard frontend
```

## 🔑 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/auth/gmail` | Get Gmail auth URL |
| POST | `/api/emails/fetch` | Manually fetch emails |
| GET | `/api/emails` | Get all processed emails |
| GET | `/api/analytics` | Get dashboard analytics |
| POST | `/api/emails/:id/send-response` | Send email response |
| PUT | `/api/emails/:id/status` | Update email status |

## 🎯 Usage

### Automatic Processing
- Emails are automatically fetched every 15 minutes
- AI processes and generates responses automatically
- Urgent emails are prioritized

### Manual Processing
1. Click "Fetch New Emails" in dashboard
2. Review AI-generated responses
3. Edit responses if needed
4. Send responses with one click

### Dashboard Features
- **Real-time Analytics**: Email volume, sentiment analysis
- **Email Filtering**: By priority, sentiment, status
- **Response Management**: Edit and send AI responses
- **Visual Charts**: Email trends over time

## 🧠 AI Features

### Sentiment Analysis
- Analyzes email tone: Positive, Negative, Neutral
- Considers emotional context for response generation

### Priority Classification
- **Urgent**: Keywords like "critical", "emergency", "asap"
- **Normal**: Standard support requests

### Response Generation
- Context-aware responses using knowledge base
- Professional and empathetic tone
- Addresses customer emotions appropriately

### Knowledge Base (RAG)
Edit `services/aiService.js` to add your company's knowledge base:
```javascript
this.knowledgeBase = {
    products: {
        'your-product': 'Product information here'
    },
    policies: {
        'refund': 'Refund policy details'
    }
};
```

## 🚨 Troubleshooting

### Common Issues

1. **"Failed to fetch emails"**
   - Check Gmail API credentials
   - Ensure refresh token is valid
   - Verify API permissions

2. **"OpenAI API Error"**
   - Verify API key is correct
   - Check API usage limits
   - Ensure sufficient credits

3. **Database errors**
   - Database is created automatically
   - Check file permissions
   - Restart server if needed

### Gmail API Issues
```bash
# Test Gmail connection
curl http://localhost:3001/api/auth/gmail
```

### OpenAI API Issues
```bash
# Test server health
curl http://localhost:3001/api/health
```

## 🔒 Security Considerations

- **API Keys**: Never commit `.env` file to version control
- **Rate Limiting**: Built-in rate limiting for API endpoints
- **Input Validation**: Email content is sanitized
- **Secure Headers**: Helmet.js for security headers

## 📈 Scaling & Production

### For Production Deployment:
1. Use environment variables for all credentials
2. Implement proper logging
3. Use Redis for session management
4. Set up SSL/HTTPS
5. Use PostgreSQL instead of SQLite
6. Implement proper error monitoring

### Performance Optimization:
- Email processing in batches
- Rate limiting for API calls
- Caching for repeated requests
- Database indexing for queries

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License - feel free to use for personal or commercial projects

## 🆘 Support

For issues or questions:
1. Check troubleshooting section
2. Review API documentation
3. Check Gmail API setup
4. Verify OpenAI configuration

---

## 🎬 Demo Video Checklist

Record a demo showing:
- [ ] Dashboard overview
- [ ] Email fetching process
- [ ] AI analysis results
- [ ] Response generation
- [ ] Sending responses
- [ ] Analytics and filtering

**Happy Email Managing! 🚀**