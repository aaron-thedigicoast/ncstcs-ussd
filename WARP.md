# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a Node.js Express application that provides USSD (Unstructured Supplementary Service Data) services for GatePlus, a loan platform. The application handles user registration, loan applications, and status checking through USSD menus.

## Technology Stack

- **Runtime**: Node.js with ES modules (`"type": "module"`)
- **Framework**: Express.js v5.1.0
- **Database**: MongoDB with Mongoose ODM
- **Session Management**: In-memory caching with `memory-cache`
- **Environment**: dotenv for configuration
- **Communication**: CORS-enabled API endpoints

## Development Commands

### Setup and Installation
```bash
npm install
```

### Running the Application
```bash
node app.js
```

### Environment Setup
Create a `.env` file in the root directory with:
```
MONGODB_URI=your_mongodb_connection_string
PORT=8000
```

## Application Architecture

### Core Components

**Single File Architecture**: The entire application logic is contained in `app.js` using a monolithic structure with clear functional separation.

### Data Models

**User Schema** (`userSchema`):
- `fullName`: User's full name with validation
- `ghanaCard`: Ghana Card ID with format validation (`GHA-XXXXXXXXX-XX`)
- `msisdn`: Mobile number (unique identifier)
- `status`: Account status (`pending_verification`, `verified`, `suspended`)
- `verifiedAt`: Verification timestamp
- `createdAt`: Registration timestamp

**Loan Schema** (`loanSchema`):
- `userId`: Reference to User document
- `msisdn`: Mobile number for quick lookup
- `amount`: Loan amount (GHS 10-1000)
- `status`: Loan status (`loan_pending`, `disbursed`, `rejected`)
- `requestedAt`: Application timestamp

**ActivityLog Schema** (`activityLogSchema`):
- `msisdn`: User identifier
- `action`: Action type (session_start, register, loan_request, etc.)
- `details`: Additional context data
- `timestamp`: Event timestamp

### Session Management

**Memory Cache Strategy**: Uses `memory-cache` with 15-minute TTL for USSD session state management.

- `getSession(sessionID)`: Retrieves session data
- `saveSession(sessionID, data)`: Stores session with automatic expiration
- Sessions store user flow state and level progression

### USSD Flow Logic

**Level-based Navigation**:
- **Level 1**: Main menu (Apply for Loan, Check Status, Support)
- **Level 2**: Loan amount input
- **Levels 10-19**: Registration flow (name input, Ghana Card validation)

**Registration Flow** (new users):
1. Level 10: Full name collection with validation
2. Level 11: Ghana Card format validation and user creation

**Existing User Flow**:
1. Level 1: Main menu navigation
2. Level 2: Loan processing (amount validation and creation)

### API Endpoints

**USSD Endpoint** (`POST /ussd`):
- Handles all USSD interactions with session-based state management
- Request format: `{sessionID, userID, newSession, msisdn, userData}`
- Response format: `{sessionID, userID, message, continueSession, msisdn}`

**Admin Endpoints**:
- `GET /admin/approve/:msisdn`: Approve user verification
- `GET /user/:msisdn`: View user profile with loans and activity logs

### Key Helper Functions

- `isValidGhanaCard(card)`: Validates Ghana Card format using regex
- `logActivity(msisdn, action, details)`: Creates activity log entries
- `respond(res, data)`: Standardized JSON response helper

### Error Handling

- MongoDB connection monitoring with event handlers
- Try-catch blocks around USSD logic with graceful degradation
- Session expiration handling with user-friendly messages
- Input validation with retry mechanisms

## Development Notes

### Database Connection
The application validates `MONGODB_URI` environment variable on startup and exits if not provided. Connection events are logged with emoji indicators for easy monitoring.

### Session State Management
Sessions are stored as arrays of state objects, allowing for complex navigation patterns and state rollback capabilities.

### Ghana Card Validation
Enforces strict format validation: `GHA-XXXXXXXXX-XX` (case-insensitive) for regulatory compliance.

### Loan Processing
- Amount restrictions: GHS 10-1000
- Automatic status progression from `loan_pending`
- Linked to user verification status

### USSD Response Format
All USSD responses follow Arkesel platform specifications with `continueSession` boolean controlling flow termination.