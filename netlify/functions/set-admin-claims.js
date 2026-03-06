const admin = require('firebase-admin');

if (!admin.apps.length) {
  const svc = { projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") };
  const admin = require("./_firebaseAdmin");
}

exports.handler = async (event) => {
  // controllo che la chiamata porti il token giusto
  if (event.headers['x-ofi-token'] !== process.env.OFI_ADMIN_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  try {
    const email = process.env.OFI_ADMIN_EMAIL; // la tua email admin
    const user = await admin.auth().getUserByEmail(email);
    const existing = user.customClaims || {};
    await admin.auth().setCustomUserClaims(user.uid, { ...existing, admin: true });
    return { statusCode: 200, body: `Admin claim impostato su ${email}` };
  } catch (e) {
    return { statusCode: 500, body: e.message || 'Unknown error' };
  }
};
