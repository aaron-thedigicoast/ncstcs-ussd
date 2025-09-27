// =========================
// Email Helpers
// =========================
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';


// Load environment variables
dotenv.config({ path: './.env' });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_FROM,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const generateEmailHtml = (username = 'courier_user') => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Complete Your PCRS Registration</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background-color: #0d6efd;
          padding: 20px;
          text-align: center;
          color: white;
        }
        .content {
          padding: 20px;
          background-color: #fff;
          border: 1px solid #eee;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #0d6efd;
          color: white !important;
          text-decoration: none;
          border-radius: 4px;
          font-weight: bold;
          margin: 15px 0;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          color: #666;
          text-align: center;
        }
        ul {
          padding-left: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Public Courier Regulatory System (PCRS)</h1>
        </div>
        <div class="content">
          <p>Hello <strong>${username}</strong>,</p>
          <p>Your account has been successfully created!</p>
          <p>To complete your registration, please log in to the PCRS portal and upload your compliance documents:</p>
          <ul>
            <li>DVLA License</li>
            <li>Ghana Card</li>
          </ul>
          <p>
            <a href="https://ncstcs.vercel.app" class="button" target="_blank">
              Go to PCRS Portal
            </a>
          </p>
          <p><strong>Instructions:</strong></p>
          <ol>
            <li>Log in with your username and password</li>
            <li>Go to your <strong>Profile</strong> page</li>
            <li>Upload your documents</li>
            <li>Submit for verification</li>
          </ol>
          <p>🔒 For security, never share your password. We will never ask for it via email or phone.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Private Courier Regulatory System. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const sendEmailAction = async ({ from, to, subject, text, html }) => {
  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html
    });
    console.log(`✅ Email sent to ${to}`);
    return { status: 200, message: "Email sent successfully", success: true };
  } catch (err) {
    console.error("📧 Email error:", err);
    return { status: 500, message: "Failed to send email.", success: false };
  }
};

export { sendEmailAction, generateEmailHtml };