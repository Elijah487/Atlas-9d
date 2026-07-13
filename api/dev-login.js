import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ok:false});
  }

  const {password, idToken} = req.body;

  if(password !== process.env.DEV_PASSWORD){
    return res.status(403).json({ok:false});
  }

  const decoded = await admin.auth().verifyIdToken(idToken);

  await admin.database()
    .ref(`dev_sessions/${decoded.uid}`)
    .set(true);

  return res.json({ok:true});
}
