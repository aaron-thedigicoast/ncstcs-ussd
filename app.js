// app.js
import express from "express";
import mongoose from "mongoose";
import cache from "memory-cache";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

// Load environment variables
dotenv.config({ path: './.env' });

// Validate required environment variables
if (!process.env.MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI environment variable is required');
    process.exit(1);
}

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    dbName: "ncstcsdb"
});

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

// =========================
// Schemas & Models
// =========================

// User Schema (courier accounts)
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "agency", "operator", "courier"], default: "courier" },
    name: { type: String },
    phone: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, sparse: true },
    dvlaNumber: { type: String, unique: true, sparse: true },
    ghanaCardNumber: { type: String, unique: true, sparse: true },
    dateOfBirth: { type: Date }
  },
  { timestamps: true }
);
const User = mongoose.model("User", userSchema);

// =========================
// Helpers
// =========================
const getSession = (sessionID) => cache.get(sessionID);
const saveSession = (sessionID, data) => cache.put(sessionID, data, 1000 * 60 * 15);

const isValidGhanaCard = (card) => /^GHA-\d{9}-\d{2}$/i.test(card.trim());
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
const isValidDVLA = (dvla) => /^[A-Za-z0-9\-]{5,}$/.test(dvla.trim());
// Ghana phone validation: accepts 024XXXXXXX, 054XXXXXXX, +23324XXXXXXX, 23324XXXXXXX
const isValidPhone = (phone) => {
  const p = (phone || "").toString().trim();
  return /^(?:0|\+?233)\d{9}$/.test(p);
};
// Normalize phone to E.164 +233XXXXXXXXX
const normalizePhone = (phone) => {
  const p = (phone || "").toString().trim();
  if (/^0\d{9}$/.test(p)) return "+233" + p.slice(1);
  if (/^233\d{9}$/.test(p)) return "+" + p;
  if (/^\+233\d{9}$/.test(p)) return p;
  return p;
};

const respond = (res, data) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
};

// =========================
// Routes
// =========================

// Root route
app.get('/', (req, res) => {
  res.status(200).send('Welcome to PCRS USSD Service');
});

// USSD Endpoint
app.post('/ussd', async (req, res) => {
  const { sessionID, userID, newSession, msisdn, userData } = req.body;
  let userSession = getSession(sessionID);

  // Helper to set and respond
  const reply = (message, continueSession = true) => {
    saveSession(sessionID, userSession);
    return respond(res, { sessionID, userID, message, continueSession, msisdn });
  };

  // Start or restart session
  if (newSession || !userSession) {
    // Try to identify user by msisdn phone
    let message = "";
    try {
      const phone = normalizePhone(msisdn || "");
      const existing = phone ? await User.findOne({ phone }) : null;
      if (existing) {
        const displayName = existing.name || existing.username || existing.phone || "Courier";
        message = `Hi ${displayName}\n1. View My Details\n2. Lookup Courier\n3. Cancel`;
        userSession = [{ level: 0, message, loggedIn: true, userRef: existing._id.toString() }];
      } else {
        message = "PCRS Couriers\n1. Sign Up\n2. Lookup Courier\n3. Cancel";
        userSession = [{ level: 0, message, loggedIn: false }];
      }
    } catch (e) {
      message = "PCRS Couriers\n1. Sign Up\n2. Lookup Courier\n3. Cancel";
      userSession = [{ level: 0, message, loggedIn: false }];
    }
    saveSession(sessionID, userSession);
    return respond(res, { sessionID, userID, message, continueSession: true, msisdn });
  }

  // Navigation: 0 = Home, 9 = Back
  if (userData === "0") {
    // Rebuild the appropriate home menu depending on login status
    const loggedIn = userSession[0]?.loggedIn;
    let message = "";
    if (loggedIn) {
      try {
        const me = await User.findById(userSession[0]?.userRef);
        const displayName = me?.name || me?.username || me?.phone || "Courier";
        message = `Hi ${displayName}\n1. View My Details\n2. Lookup Courier\n3. Cancel`;
      } catch {
        message = "Hi Courier\n1. View My Details\n2. Lookup Courier\n3. Cancel";
      }
      userSession = [{ level: 0, message, loggedIn: true, userRef: userSession[0]?.userRef }];
    } else {
      message = "PCRS Couriers\n1. Sign Up\n2. Lookup Courier\n3. Cancel";
      userSession = [{ level: 0, message, loggedIn: false }];
    }
    return reply(message, true);
  }
  if (userData === "9") {
    if (userSession.length > 1) userSession.pop();
    const prev = userSession[userSession.length - 1];
    return reply(prev.message, true);
  }

  const current = userSession[userSession.length - 1];
  let message = "";
  try {
    switch (current.level) {
      case 0: {
        if (current.loggedIn) {
          if (userData === "1") {
            // View My Details
            try {
              const me = await User.findById(userSession[0]?.userRef);
              if (!me) {
                message = "Account not found.";
              } else {
                const summary = `Name: ${me.name || "-"}\nUsername: ${me.username}\nPhone: ${me.phone || "-"}\nEmail: ${me.email || "-"}\nDVLA: ${me.dvlaNumber || "-"}\nGhanaCard: ${me.ghanaCardNumber || "-"}`;
                message = summary;
              }
            } catch {
              message = "Unable to fetch details at the moment.";
            }
            cache.del(sessionID);
            return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
          } else if (userData === "2") {
            message = "Enter DVLA or Ghana Card Number:";
            userSession.push({ level: 30, message });
            return reply(message, true);
          } else {
            message = "Session ended.";
            cache.del(sessionID);
            return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
          }
        } else {
          if (userData === "1") {
            // Show info screen before sign-up
            message = "📄 To register, you'll need:\n\n• DVLA License Number\n• Ghana Card (e.g., GHA-123456789-01)\n\nWe'll also collect:\n• Full Name\n• Username\n• Phone\n• Email\n• Password\n\nPress 1 to continue";
            userSession.push({ level: 5, message });
            return reply(message, true);
          } else if (userData === "2") {
            message = "Enter DVLA or Ghana Card Number:";
            userSession.push({ level: 30, message });
            return reply(message, true);
          } else {
            message = "Session ended.";
            cache.del(sessionID);
            return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
          }
        }
      }

      // Info screen before sign-up
      case 5: {
        // Proceed to name entry regardless of input (USSD convention)
        message = "Enter Full Name:";
        userSession.push({ level: 10, message });
        return reply(message, true);
      }

      // Sign Up Flow
      case 10: { // Full Name
        const name = (userData || "").trim();
        if (!name || name.length < 3 || /\d/.test(name)) {
          message = "Invalid name. Enter Full Name:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        message = "Choose a Username:";
        userSession.push({ level: 11, name, message });
        return reply(message);
      }
      case 11: { // Username
        const username = (userData || "").trim();
        if (!/^[a-zA-Z0-9_\.\-]{3,20}$/.test(username)) {
          message = "Invalid username. Try again:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        const exists = await User.findOne({ username });
        if (exists) {
          message = "Username taken. Enter a different Username:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        message = "Enter Phone Number (e.g., 024XXXXXXX):";
        userSession.push({ level: 12, name: current.name, username, message });
        return reply(message);
      }
      case 12: { // Phone
        const rawPhone = (userData || "").trim();
        if (!isValidPhone(rawPhone)) {
          message = "Invalid phone. Enter Phone Number (e.g., 024XXXXXXX):";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        const phone = normalizePhone(rawPhone);
        const exists = await User.findOne({ phone });
        if (exists) {
          message = "Phone already registered. Enter a different Phone Number:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        message = "Enter Email:";
        userSession.push({ level: 13, name: current.name, username: current.username, phone, message });
        return reply(message);
      }
      case 13: { // Email
        const email = (userData || "").trim();
        if (!isValidEmail(email)) {
          message = "Invalid email. Enter Email:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        const exists = await User.findOne({ email });
        if (exists) {
          message = "Email already in use. Enter a different Email:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        message = "Create Password:";
        userSession.push({ level: 14, name: current.name, username: current.username, phone: current.phone, email, message });
        return reply(message);
      }
      case 14: { // Password
        const password = (userData || "").trim();
        if (password.length < 6) {
          message = "Password too short (min 6). Create Password:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        message = "Confirm Password:";
        userSession.push({ ...current, level: 15, password, message });
        return reply(message);
      }
      case 15: { // Confirm Password
        const confirm = (userData || "").trim();
        if (confirm !== current.password) {
          message = "Passwords do not match. Create Password:";
          // Go back to password step
          userSession.pop();
          userSession[userSession.length - 1] = { ...userSession[userSession.length - 1], message };
          return reply(message);
        }
        message = "Enter DVLA License Number:";
        userSession.push({ ...current, level: 16, message });
        return reply(message);
      }
      case 16: { // DVLA Number
        const dvlaNumber = (userData || "").trim().toUpperCase();
        if (!isValidDVLA(dvlaNumber)) {
          message = "Invalid DVLA number. Enter DVLA License Number:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        const exists = await User.findOne({ dvlaNumber });
        if (exists) {
          message = "DVLA already registered. Enter a different DVLA License Number:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        message = "Enter Ghana Card (e.g., GHA-123456789-01):";
        userSession.push({ ...current, level: 17, dvlaNumber, message });
        return reply(message);
      }
      case 17: { // Ghana Card Number
        const ghanaCardNumber = (userData || "").trim().toUpperCase();
        if (!isValidGhanaCard(ghanaCardNumber)) {
          message = "Invalid format. Use GHA-XXXXXXXXX-XX:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        const exists = await User.findOne({ ghanaCardNumber });
        if (exists) {
          message = "Ghana Card already registered. Enter a different Ghana Card:";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }

        // Create user
        const { name, username, phone, email, password, dvlaNumber } = current;
        const hashed = await bcrypt.hash(password, 10);
        try {
          await User.create({
            username,
            password: hashed,
            role: "courier",
            name,
            phone,
            email,
            dvlaNumber,
            ghanaCardNumber
          });
        } catch (e) {
          message = "Registration failed. Try again later.";
          cache.del(sessionID);
          return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
        }
        message = "Registration successful!\n\nAn SMS will be sent to your phone shortly. Please follow the link in the SMS to upload your:\n• DVLA License\n• Ghana Card";
        cache.del(sessionID);
        return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
      }

      // Lookup Flow
      case 30: {
        const query = (userData || "").trim().toUpperCase();
        let user = null;
        if (isValidGhanaCard(query)) {
          user = await User.findOne({ ghanaCardNumber: query });
        } else {
          // treat as DVLA if not ghana card
          user = await User.findOne({ dvlaNumber: query });
        }
        if (!user) {
          message = "Courier not found. 9.Back 0.Home";
          userSession[userSession.length - 1] = { ...current, message };
          return reply(message);
        }
        const summary = `Name: ${user.name || "-"}\nUsername: ${user.username}\nPhone: ${user.phone || "-"}\nEmail: ${user.email || "-"}\nDVLA: ${user.dvlaNumber || "-"}\nGhanaCard: ${user.ghanaCardNumber || "-"}`;
        message = `${summary}`;
        cache.del(sessionID);
        return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
      }

      default: {
        message = "Session reset.";
        const home = "PCRS Couriers\n1. Sign Up\n2. Lookup Courier\n3. Cancel";
        userSession = [{ level: 0, message: home }];
        return reply(home);
      }
    }
  } catch (err) {
    console.error("USSD Error:", err?.message || err);
    message = "Service temporarily unavailable. Try later.";
    cache.del(sessionID);
    return respond(res, { sessionID, userID, message, continueSession: false, msisdn });
  }
});

// =========================
// Courier APIs (optional HTTP)
// =========================
app.get('/courier/lookup', async (req, res) => {
  const id = (req.query.id || "").toString().trim().toUpperCase();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  let user = null;
  if (isValidGhanaCard(id)) user = await User.findOne({ ghanaCardNumber: id });
  if (!user) user = await User.findOne({ dvlaNumber: id });
  if (!user) return res.status(404).json({ error: 'Not found' });
  return res.json({
    username: user.username,
    name: user.name,
    phone: user.phone,
    email: user.email,
    dvlaNumber: user.dvlaNumber,
    ghanaCardNumber: user.ghanaCardNumber,
    role: user.role,
    createdAt: user.createdAt
  });
});

// =========================
// Start Server
// =========================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`✅ PCRS Courier USSD running on port ${PORT}`);
  console.log(`🔗 MongoDB: ${process.env.MONGODB_URI}`);
});