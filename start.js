#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 AI-Powered Email Assistant - Startup Check');
console.log('=============================================');

// Check if .env file exists and is configured
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found!');
    console.log('📝 Please create .env file with your API keys');
    console.log('📖 Check README.md for setup instructions');
    process.exit(1);
}

// Read .env and check for required keys
const envContent = fs.readFileSync(envPath, 'utf8');
const requiredKeys = [
    'OPENAI_API_KEY',
    'GMAIL_CLIENT_ID', 
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN'
];

const missingKeys = requiredKeys.filter(key => 
    !envContent.includes(`${key}=`) || envContent.includes(`${key}=your_`)
);

if (missingKeys.length > 0) {
    console.log('⚠️  Configuration incomplete:');
    missingKeys.forEach(key => {
        console.log(`   - ${key} not configured`);
    });
    console.log('\n📝 Please update your .env file');
    console.log('📖 Check README.md for setup instructions');
    
    if (missingKeys.includes('GMAIL_REFRESH_TOKEN')) {
        console.log('\n🔐 To get Gmail refresh token:');
        console.log('   1. Start server: npm start');
        console.log('   2. Visit: http://localhost:3001/api/auth/gmail');
        console.log('   3. Complete OAuth and copy refresh token');
    }
} else {
    console.log('✅ Configuration looks good!');
}

// Create required directories
const dirs = ['database', 'public'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

console.log('\n🎯 Starting server...');
console.log('📊 Dashboard: http://localhost:3001');
console.log('🔧 API: http://localhost:3001/api');
console.log('❤️  Health: http://localhost:3001/api/health');

// Start the actual server
require('./server.js');