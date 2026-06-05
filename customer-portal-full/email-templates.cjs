/**
 * InsurePortal Email Template Engine
 * 
 * HTML email templates with InsurePortal branding for:
 * - Welcome / Account created
 * - Password reset OTP
 * - Policy confirmation
 * - Claim status update
 * - Payment receipt
 * - KYC verification
 * - Policy renewal reminder
 */

const BRAND = {
  name: 'InsurePortal',
  color: '#1a5276',
  accent: '#27ae60',
  logo: 'https://insureportal.ng/logo.png',
  support: 'support@insureportal.ng',
  phone: '+234 (0) 700-INSURE',
  address: '14 Adeola Odeku Street, Victoria Island, Lagos',
};

function baseLayout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f4f6f9;color:#333">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:20px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:${BRAND.color};padding:24px 32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px">${BRAND.name}</h1>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Nigeria's Digital Insurance Platform</p>
  </td></tr>
  <tr><td style="padding:32px">${body}</td></tr>
  <tr><td style="background:#f8f9fa;padding:20px 32px;text-align:center;font-size:12px;color:#888">
    <p style="margin:0">Need help? Contact us at <a href="mailto:${BRAND.support}" style="color:${BRAND.color}">${BRAND.support}</a> or call ${BRAND.phone}</p>
    <p style="margin:8px 0 0">${BRAND.address}</p>
    <p style="margin:8px 0 0;color:#aaa">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved. Licensed by NAICOM.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

const templates = {
  welcome(data) {
    return {
      subject: `Welcome to ${BRAND.name}, ${data.name}!`,
      html: baseLayout('Welcome', `
        <h2 style="color:${BRAND.color};margin-top:0">Welcome, ${data.name}!</h2>
        <p>Your ${BRAND.name} account has been created successfully. You're now part of Nigeria's most advanced digital insurance platform.</p>
        <div style="background:#f0f7ff;border-left:4px solid ${BRAND.color};padding:16px;margin:20px 0;border-radius:4px">
          <p style="margin:0"><strong>Account Email:</strong> ${data.email}</p>
          <p style="margin:8px 0 0"><strong>KYC Level:</strong> ${data.kycLevel || 0} — Complete your KYC to unlock full features</p>
        </div>
        <p>Next steps:</p>
        <ol style="padding-left:20px">
          <li>Complete your KYC verification</li>
          <li>Browse our insurance products</li>
          <li>Get an instant quote</li>
        </ol>
        <a href="${data.loginUrl || 'https://insureportal.ng/auth'}" style="display:inline-block;background:${BRAND.accent};color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Get Started</a>
      `),
    };
  },

  passwordReset(data) {
    return {
      subject: `${BRAND.name} — Password Reset Code`,
      html: baseLayout('Password Reset', `
        <h2 style="color:${BRAND.color};margin-top:0">Password Reset Request</h2>
        <p>Use the following one-time code to reset your password:</p>
        <div style="text-align:center;margin:24px 0">
          <span style="display:inline-block;background:#f0f7ff;border:2px solid ${BRAND.color};padding:16px 40px;font-size:32px;font-weight:700;letter-spacing:8px;border-radius:8px;font-family:monospace">${data.otp}</span>
        </div>
        <p style="color:#888;font-size:13px">This code expires in ${data.expiresIn || '10 minutes'}. If you didn't request this, please ignore this email or contact support.</p>
      `),
    };
  },

  policyConfirmation(data) {
    return {
      subject: `${BRAND.name} — Policy ${data.policyNumber} Confirmed`,
      html: baseLayout('Policy Confirmation', `
        <h2 style="color:${BRAND.color};margin-top:0">Policy Confirmed</h2>
        <p>Your insurance policy has been issued successfully.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Policy Number</td><td style="padding:10px 0;font-weight:600;text-align:right">${data.policyNumber}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Type</td><td style="padding:10px 0;text-align:right">${data.type}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Sum Assured</td><td style="padding:10px 0;text-align:right">&#8358;${Number(data.sumAssured || 0).toLocaleString()}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Premium</td><td style="padding:10px 0;text-align:right">&#8358;${Number(data.premium || 0).toLocaleString()}</td></tr>
          <tr><td style="padding:10px 0;color:#888">Status</td><td style="padding:10px 0;text-align:right;color:${BRAND.accent};font-weight:600">${data.status || 'Active'}</td></tr>
        </table>
        <p style="font-size:13px;color:#888">Keep this email for your records. You can view your policy details anytime on the ${BRAND.name} portal.</p>
      `),
    };
  },

  claimStatusUpdate(data) {
    const statusColors = { 'Submitted': '#f39c12', 'Under Review': '#3498db', 'Approved': '#27ae60', 'Rejected': '#e74c3c', 'Paid': '#27ae60' };
    const color = statusColors[data.status] || '#888';
    return {
      subject: `${BRAND.name} — Claim ${data.claimNumber} ${data.status}`,
      html: baseLayout('Claim Update', `
        <h2 style="color:${BRAND.color};margin-top:0">Claim Status Update</h2>
        <div style="text-align:center;margin:20px 0">
          <span style="display:inline-block;background:${color}20;color:${color};padding:8px 24px;border-radius:20px;font-weight:600">${data.status}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Claim Number</td><td style="padding:10px 0;font-weight:600;text-align:right">${data.claimNumber}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Amount</td><td style="padding:10px 0;text-align:right">&#8358;${Number(data.amount || 0).toLocaleString()}</td></tr>
          ${data.reason ? `<tr><td style="padding:10px 0;color:#888">Notes</td><td style="padding:10px 0;text-align:right">${data.reason}</td></tr>` : ''}
        </table>
        ${data.status === 'Approved' ? `<p style="color:${BRAND.accent};font-weight:600">Payment will be processed within 3-5 business days.</p>` : ''}
      `),
    };
  },

  paymentReceipt(data) {
    return {
      subject: `${BRAND.name} — Payment Receipt #${data.receiptNumber}`,
      html: baseLayout('Payment Receipt', `
        <h2 style="color:${BRAND.color};margin-top:0">Payment Receipt</h2>
        <div style="text-align:center;margin:20px 0">
          <span style="font-size:36px;font-weight:700;color:${BRAND.color}">&#8358;${Number(data.amount || 0).toLocaleString()}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Receipt #</td><td style="padding:10px 0;text-align:right">${data.receiptNumber}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Policy</td><td style="padding:10px 0;text-align:right">${data.policyNumber || 'N/A'}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Gateway</td><td style="padding:10px 0;text-align:right">${data.gateway || 'Paystack'}</td></tr>
          <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Reference</td><td style="padding:10px 0;text-align:right;font-family:monospace">${data.reference}</td></tr>
          <tr><td style="padding:10px 0;color:#888">Date</td><td style="padding:10px 0;text-align:right">${data.date || new Date().toLocaleDateString('en-NG')}</td></tr>
        </table>
        <p style="color:${BRAND.accent};font-weight:600;text-align:center">Payment Successful</p>
      `),
    };
  },

  renewalReminder(data) {
    return {
      subject: `${BRAND.name} — Policy ${data.policyNumber} Renewal Due`,
      html: baseLayout('Renewal Reminder', `
        <h2 style="color:${BRAND.color};margin-top:0">Policy Renewal Reminder</h2>
        <p>Your insurance policy is due for renewal.</p>
        <div style="background:#fff3cd;border-left:4px solid #f39c12;padding:16px;margin:20px 0;border-radius:4px">
          <p style="margin:0"><strong>${data.policyNumber}</strong> — ${data.type}</p>
          <p style="margin:8px 0 0">Expires: <strong>${data.expiryDate}</strong> (${data.daysRemaining} days remaining)</p>
        </div>
        <p>Renewal premium: <strong>&#8358;${Number(data.renewalPremium || 0).toLocaleString()}</strong></p>
        <a href="${data.renewUrl || 'https://insureportal.ng/policies'}" style="display:inline-block;background:${BRAND.accent};color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Renew Now</a>
        <p style="font-size:13px;color:#888">Failure to renew may result in a lapse of coverage. Contact your agent or our support team for assistance.</p>
      `),
    };
  },
};

function renderEmail(templateName, data) {
  if (!templates[templateName]) return null;
  return templates[templateName](data);
}

module.exports = { renderEmail, templates, BRAND };
