// app.js
import express from "express";
import mongoose from "mongoose";
import cache from "memory-cache";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({path: './.env'});

// Validate required environment variables
if (!process.env.MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI environment variable is required');
    console.error('Please create a .env file with MONGODB_URI=your_mongodb_connection_string');
    process.exit(1);
}

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI);

// MongoDB connection event handlers
mongoose.connection.on('connected', () => {
    console.log('✅ Connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️  Disconnected from MongoDB');
});

// User Schema
const userSchema = new mongoose.Schema({
    fullName: {type: String, required: true},
    ghanaCard: {
        type: String,
        required: true,
        match: [/^GHA-\d{9}-\d{2}$/i, 'Invalid Ghana Card format']
    },
    msisdn: {type: String, required: true, unique: true, index: true},
    status: {
        type: String,
        enum: ['pending_verification', 'verified', 'suspended'],
        default: 'pending_verification'
    },
    verifiedAt: Date,
    createdAt: {type: Date, default: Date.now}
});

const User = mongoose.model('User', userSchema);

// Loan Schema
const loanSchema = new mongoose.Schema({
    userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    msisdn: {type: String, required: true},
    amount: {type: Number, min: 10, max: 1000, required: true},
    status: {
        type: String,
        enum: ['loan_pending', 'disbursed', 'rejected'],
        default: 'loan_pending'
    },
    requestedAt: {type: Date, default: Date.now}
});

const Loan = mongoose.model('Loan', loanSchema);

// Activity Log Schema
const activityLogSchema = new mongoose.Schema({
    msisdn: {type: String, required: true},
    action: {type: String, required: true},
    details: mongoose.Schema.Types.Mixed,
    timestamp: {type: Date, default: Date.now}
});

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

// In-memory session cache
const getSession = (sessionID) => cache.get(sessionID);
const saveSession = (sessionID, data) => cache.put(sessionID, data, 1000 * 60 * 15); // 15 min

// Helper: Validate Ghana Card
const isValidGhanaCard = (card) => /^GHA-\d{9}-\d{2}$/i.test(card.trim());

// Log user activity
const logActivity = async (msisdn, action, details = {}) => {
    await ActivityLog.create({msisdn, action, details});
};

// Response helper
const respond = (res, data) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
};

// Root route
app.get('/', (req, res) => {
    res.status(200).send('Welcome to GatePlus - Your Trusted Loan Partner!');
});

// USSD Endpoint
app.post('/ussd', async (req, res) => {
    const {sessionID, userID, newSession, msisdn, userData} = req.body;

    let userSession = getSession(sessionID);

    if (newSession) {
        const userRecord = await User.findOne({msisdn});
        let message;

        if (!userRecord) {
            message = "Welcome to GatePlus!\nRegister for verification to access loans.\nEnter your Full Name:";
        } else {
            message = `Hi there!\n1. Apply for Loan\n2. Check Status\n3. Support`;
        }

        const newState = {
            sessionID,
            msisdn,
            level: userRecord ? 1 : 10,
            message,
        };

        saveSession(sessionID, [newState]);
        await logActivity(msisdn, 'session_start', {isNew: !userRecord});

        return respond(res, {sessionID, userID, message, continueSession: true, msisdn});
    }

    if (!userSession || userSession.length === 0) {
        return respond(res, {
            sessionID,
            userID,
            message: "Session expired. Please restart.",
            continueSession: false,
            msisdn
        });
    }

    const currentState = userSession[userSession.length - 1];
    let message = "";
    let continueSession = true;

    try {
        // === REGISTRATION FLOW (new users) ===
        if (currentState.level >= 10 && currentState.level < 20) {
            switch (currentState.level) {
                case 10: {
                    const fullName = userData.trim();
                    if (fullName.length < 2 || /\d/.test(fullName)) {
                        message = "Please enter a valid name (no numbers).";
                        return respond(res, {sessionID, userID, message, continueSession: true, msisdn});
                    }

                    message = "Enter Ghana Card (e.g., GHA-123456789-01):";
                    userSession.push({level: 11, message, fullName});
                    saveSession(sessionID, userSession);
                    break;
                }

                case 11: {
                    const ghanaCard = userData.trim().toUpperCase();
                    if (!isValidGhanaCard(ghanaCard)) {
                        message = "Invalid format. Use GHA-XXXXXXXXX-XX:";
                        const retry = {...currentState, message};
                        userSession[userSession.length - 1] = retry;
                        saveSession(sessionID, userSession);
                        return respond(res, {sessionID, userID, message, continueSession: true, msisdn});
                    }

                    const previousState = userSession.find(s => s.level === 10);
                    const fullName = previousState?.fullName || "Unknown";

                    const existingUser = await User.findOne({msisdn});
                    if (existingUser) {
                        message = "You are already registered.";
                        continueSession = false;
                        cache.del(sessionID);
                        break;
                    }

                    const newUser = new User({
                        fullName,
                        ghanaCard,
                        msisdn,
                        status: 'pending_verification'
                    });

                    await newUser.save();
                    await logActivity(msisdn, 'register', {fullName, ghanaCard});

                    message = `Thank you, ${newUser.fullName}!\nVerification pending. You'll be notified.`;
                    continueSession = false;
                    cache.del(sessionID);
                    break;
                }
            }
            return respond(res, {sessionID, userID, message, continueSession, msisdn});
        }

        // === EXISTING USER FLOW ===
        const userRecord = await User.findOne({msisdn});
        if (!userRecord) {
            message = "User not found. Please restart.";
            return respond(res, {sessionID, userID, message, continueSession: false, msisdn});
        }

        await logActivity(msisdn, 'menu', {level: currentState.level, input: userData});

        switch (currentState.level) {
            case 1: {
                if (userData === "1") {
                    if (userRecord.status !== 'verified') {
                        message = "Account under review. Please wait for approval.";
                        continueSession = false;
                    } else {
                        message = "Enter loan amount (GHS 10 - 1000):";
                        userSession.push({level: 2, message});
                        saveSession(sessionID, userSession);
                    }
                } else if (userData === "2") {
                    const latestLoan = await Loan.findOne({msisdn}).sort({requestedAt: -1});
                    if (!latestLoan) {
                        message = "No loan history.";
                    } else {
                        message = `Status: ${latestLoan.status.toUpperCase()}\nAmount: GHS ${latestLoan.amount}\nApplied: ${latestLoan.requestedAt.toLocaleDateString()}`;
                    }
                    continueSession = false;
                } else if (userData === "3") {
                    message = "Support: Call 0800-GATEPLUS or WhatsApp +233 123 456 789";
                    continueSession = false;
                } else {
                    message = "Invalid option. Choose 1, 2, or 3.";
                    continueSession = false;
                }
                break;
            }

            case 2: {
                const amount = parseFloat(userData);
                if (isNaN(amount) || amount < 10 || amount > 1000) {
                    message = "Enter amount between GHS 10 and 1000:";
                    const retry = {...currentState, message};
                    userSession[userSession.length - 1] = retry;
                    saveSession(sessionID, userSession);
                    return respond(res, {sessionID, userID, message, continueSession: true, msisdn});
                }

                const loan = new Loan({
                    userId: userRecord._id,
                    msisdn,
                    amount,
                    status: 'loan_pending'
                });

                await loan.save();
                await logActivity(msisdn, 'loan_request', {amount, loanId: loan._id});

                message = `Loan request for GHS ${amount} received!\nProcessing... Funds will be sent shortly.`;
                continueSession = false;
                cache.del(sessionID);
                break;
            }

            default: {
                message = "An error occurred.";
                continueSession = false;
                break;
            }
        }
    } catch (err) {
        console.error("USSD Error:", err.message);
        message = "Service temporarily unavailable. Try later.";
        continueSession = false;
        cache.del(sessionID);
    }

    respond(res, {sessionID, userID, message, continueSession, msisdn});
});

// ✅ Admin: Approve user verification
app.get('/admin/approve/:msisdn', async (req, res) => {
    const {msisdn} = req.params;

    const user = await User.findOne({msisdn});
    if (!user) {
        return respond(res, {status: 'error', message: 'User not found'});
    }

    user.status = 'verified';
    user.verifiedAt = new Date();
    await user.save();

    await logActivity(msisdn, 'admin_action', {action: 'approved'});

    respond(res, {status: 'success', message: `User ${msisdn} verified!`});
});

// ✅ View user profile (for admin/debug)
app.get('/user/:msisdn', async (req, res) => {
    const {msisdn} = req.params;
    const user = await User.findOne({msisdn});
    const loans = await Loan.find({msisdn}).sort({requestedAt: -1}).limit(5);
    const logs = await ActivityLog.find({msisdn}).sort({timestamp: -1}).limit(10);

    if (!user) {
        return respond(res, {error: "User not found"});
    }

    respond(res, {user, loans, activity: logs});
});

// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`✅ GatePlus USSD Service running on port ${PORT}`);
    console.log(`🔗 MongoDB: ${process.env.MONGODB_URI}`);
});
