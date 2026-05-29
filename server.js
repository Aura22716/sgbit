const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'sgbit-super-secret-key-12345';

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'med-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ==========================================
// SMTP EMAIL NOTIFICATION CONTROLLERS
// ==========================================
let mailTransporter;
async function initMailer() {
  try {
    const testAccount = await nodemailer.createTestAccount();
    mailTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log("📨 Nodemailer active: Simulated SMTP mail carrier initialized.");
  } catch (err) {
    console.warn("⚠️ SMTP initialization warning. Mailer will default to local console logging.");
  }
}

async function sendOTPEmail(toEmail, usn, otp) {
  const mailOptions = {
    from: '"SGBIT Attendance System" <noreply@sgbit.edu.in>',
    to: toEmail,
    subject: "🔑 Your SGBIT Verification OTP Code",
    text: `Hello SGBITian,\n\nYour security verification OTP code for USN/ID: ${usn} is:\n\n👉  ${otp}\n\nThis OTP is valid for 5 minutes.\n\nBest regards,\nSGBIT Administration`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f9; border-radius: 8px;">
        <h2 style="color: #4f46e5; text-align: center;">SGBIT Attendance</h2>
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <p>Hello SGBITian,</p>
          <p>Your requested security verification OTP code for USN/ID <strong>${usn}</strong> is:</p>
          <div style="text-align: center; margin: 25px 0;">
            <span style="font-size: 2.25rem; font-weight: 800; letter-spacing: 4px; color: #4f46e5; background: #e0e7ff; padding: 10px 24px; border-radius: 6px;">${otp}</span>
          </div>
          <p style="color: #6b7280; font-size: 0.85rem;">This code will expire in 5 minutes.</p>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 0.75rem; margin-top: 15px;">SGBIT Engineering Department Campus Portal System</p>
      </div>
    `
  };

  if (mailTransporter) {
    try {
      const info = await mailTransporter.sendMail(mailOptions);
      console.log(`✉️ Email successfully dispatched to ${toEmail}. Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
    } catch (err) {
      console.error("❌ Nodemailer failed to send email. Fallback: Logged to console.");
    }
  }
  
  console.log(`=========================================`);
  console.log(`📨 [SMTP EMAIL DISPATCH]`);
  console.log(`TO: ${toEmail}`);
  console.log(`OTP SECURE CODE: ${otp}`);
  console.log(`=========================================`);
}

// ==========================================
// DUAL-DATABASE ARCHITECTURE (FIREBASE & SQLITE)
// ==========================================
let dbMode = 'sqlite'; // 'sqlite' | 'firebase'
let sqliteDb;
let firestoreDb;
let bucket;

const firebaseConfigPath = path.join(__dirname, 'firebase-config.json');

async function initDatabases() {
  if (fs.existsSync(firebaseConfigPath)) {
    try {
      const serviceAccount = require(firebaseConfigPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: `${serviceAccount.project_id}.appspot.com`
      });
      firestoreDb = admin.firestore();
      bucket = admin.storage().bucket();
      dbMode = 'firebase';
      console.log(`=======================================================`);
      console.log(`🔥 Connected to Google Firebase Cloud Firestore successfully!`);
      console.log(`📁 Google Firebase Storage Bucket linked for Medical Leaves!`);
      console.log(`=======================================================`);
      
      // Auto seed Firebase with mock admins if collection is empty
      await seedFirebaseDb();
      return;
    } catch (err) {
      console.error("⚠️ Failed to initialize Firebase SDK, falling back to local SQLite.", err.message);
    }
  }

  // Local SQLite Fallback Mode
  sqliteDb = await open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });
  await sqliteDb.run('PRAGMA foreign_keys = ON');

  // Initialize SQLite Tables
  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usn TEXT UNIQUE,
      name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT CHECK(role IN ('student', 'teacher', 'admin')),
      otp TEXT,
      otp_expiry INTEGER
    )
  `);

  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      code TEXT UNIQUE,
      target INTEGER DEFAULT 75,
      color TEXT,
      teacher_id INTEGER,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS enrollments (
      student_id INTEGER,
      subject_id INTEGER,
      PRIMARY KEY (student_id, subject_id),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    )
  `);

  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      subject_id INTEGER,
      date TEXT,
      status TEXT CHECK(status IN ('present', 'absent', 'late', 'medical', 'holiday', 'cancelled')),
      medical_certificate TEXT,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      UNIQUE(student_id, subject_id, date)
    )
  `);

  // Seed SQLite mock data
  const userCount = await sqliteDb.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    const studentPass = await bcrypt.hash('password123', 10);
    const teacherPass = await bcrypt.hash('password123', 10);
    const adminPass = await bcrypt.hash('password123', 10);

    // Add Users
    const prajwalId = (await sqliteDb.run('INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', ['2GB20CS001', 'Prajwal K', 'prajwal@sgbit.edu.in', studentPass, 'student'])).lastID;
    const amitId = (await sqliteDb.run('INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', ['2GB20CS002', 'Amit Kumar', 'amit@sgbit.edu.in', studentPass, 'student'])).lastID;
    const snehaId = (await sqliteDb.run('INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', ['2GB20CS003', 'Sneha Patil', 'sneha@sgbit.edu.in', studentPass, 'student'])).lastID;
    const teacherId = (await sqliteDb.run('INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', ['SGBIT-TEA-01', 'Dr. Patil (Teacher)', 'patil@sgbit.edu.in', teacherPass, 'teacher'])).lastID;
    await sqliteDb.run('INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', ['SGBIT-ADM-01', 'System Administrator', 'admin@sgbit.edu.in', adminPass, 'admin']);

    // Add Subjects assigned to teacher
    const sub1 = (await sqliteDb.run('INSERT INTO subjects (name, code, target, color, teacher_id) VALUES (?, ?, ?, ?, ?)', ['Computer Networks', 'CS-601', 75, 'hsl(245, 82%, 67%)', teacherId])).lastID;
    const sub2 = (await sqliteDb.run('INSERT INTO subjects (name, code, target, color, teacher_id) VALUES (?, ?, ?, ?, ?)', ['Software Engineering', 'CS-602', 75, 'hsl(142, 70%, 45%)', teacherId])).lastID;
    const sub3 = (await sqliteDb.run('INSERT INTO subjects (name, code, target, color, teacher_id) VALUES (?, ?, ?, ?, ?)', ['Web Technology', 'CS-603', 80, 'hsl(38, 92%, 50%)', teacherId])).lastID;
    const sub4 = (await sqliteDb.run('INSERT INTO subjects (name, code, target, color, teacher_id) VALUES (?, ?, ?, ?, ?)', ['Cryptography & Security', 'CS-604', 75, 'hsl(350, 89%, 60%)', teacherId])).lastID;

    // Enroll students
    const students = [prajwalId, amitId, snehaId];
    const subjects = [sub1, sub2, sub3, sub4];

    for (const stud of students) {
      for (const subj of subjects) {
        await sqliteDb.run('INSERT INTO enrollments (student_id, subject_id) VALUES (?, ?)', [stud, subj]);
      }
    }

    const dates = [
      new Date().toISOString().split('T')[0],
      new Date(Date.now() - 86400000).toISOString().split('T')[0],
      new Date(Date.now() - 172800000).toISOString().split('T')[0]
    ];

    await sqliteDb.run('INSERT INTO attendance (student_id, subject_id, date, status) VALUES (?, ?, ?, ?)', [prajwalId, sub1, dates[0], 'present']);
    await sqliteDb.run('INSERT INTO attendance (student_id, subject_id, date, status) VALUES (?, ?, ?, ?)', [prajwalId, sub1, dates[1], 'present']);
    await sqliteDb.run('INSERT INTO attendance (student_id, subject_id, date, status) VALUES (?, ?, ?, ?)', [prajwalId, sub1, dates[2], 'absent']);

    console.log("🎓 Local SQLite Relational database successfully pre-populated!");
  }
}

async function seedFirebaseDb() {
  const usersRef = firestoreDb.collection('users');
  const count = (await usersRef.limit(1).get()).size;
  if (count === 0) {
    const studentPass = await bcrypt.hash('password123', 10);
    const teacherPass = await bcrypt.hash('password123', 10);
    const adminPass = await bcrypt.hash('password123', 10);

    // Add admin
    await usersRef.doc('SGBIT-ADM-01').set({ usn: 'SGBIT-ADM-01', name: 'System Administrator', email: 'admin@sgbit.edu.in', password_hash: adminPass, role: 'admin' });
    // Add teacher
    await usersRef.doc('SGBIT-TEA-01').set({ usn: 'SGBIT-TEA-01', name: 'Dr. Patil (Teacher)', email: 'patil@sgbit.edu.in', password_hash: teacherPass, role: 'teacher' });
    // Add student
    await usersRef.doc('2GB20CS001').set({ usn: '2GB20CS001', name: 'Prajwal K', email: 'prajwal@sgbit.edu.in', password_hash: studentPass, role: 'student' });
    
    // Add Subjects
    const subRef = firestoreDb.collection('subjects');
    await subRef.doc('sub-cn').set({ id: 'sub-cn', name: 'Computer Networks', code: 'CS-601', target: 75, color: 'hsl(245, 82%, 67%)', teacher_id: 'SGBIT-TEA-01' });
    await subRef.doc('sub-se').set({ id: 'sub-se', name: 'Software Engineering', code: 'CS-602', target: 75, color: 'hsl(142, 70%, 45%)', teacher_id: 'SGBIT-TEA-01' });

    console.log("🔥 Cloud Firebase seeded with default demo credentials!");
  }
}

// Authentication verification
async function authenticateToken(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ error: "Access Denied. Please log in." });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: "Invalid Session." });
  }
}

// ==========================================
// BACKEND API CONTROLLERS (Supports Dual Modes)
// ==========================================

// Register Account
app.post('/api/auth/register', async (req, res) => {
  const { usn, name, email, password, role } = req.body;
  if (!usn || !name || !email || !password || !role) {
    return res.status(400).json({ error: "Please enter all required fields." });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const upperUsn = usn.trim().toUpperCase();
    const lowerEmail = email.trim().toLowerCase();

    if (dbMode === 'firebase') {
      const userRef = firestoreDb.collection('users').doc(upperUsn);
      const doc = await userRef.get();
      if (doc.exists) return res.status(400).json({ error: "USN/Roll number is already registered." });

      const emailCheck = await firestoreDb.collection('users').where('email', '==', lowerEmail).get();
      if (!emailCheck.empty) return res.status(400).json({ error: "Email address is already registered." });

      await userRef.set({ usn: upperUsn, name, email: lowerEmail, password_hash, role });
      
      const token = jwt.sign({ id: upperUsn, usn: upperUsn, role }, JWT_SECRET, { expiresIn: '1d' });
      res.cookie('auth_token', token, { httpOnly: true, maxAge: 86400000 });
      return res.status(201).json({ success: true, user: { usn: upperUsn, name, role, email: lowerEmail } });
    } else {
      // SQLite Mode
      const result = await sqliteDb.run(
        'INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [upperUsn, name.trim(), lowerEmail, password_hash, role]
      );
      
      // Auto enroll
      if (role === 'student') {
        const subs = await sqliteDb.all('SELECT id FROM subjects');
        for (const sub of subs) {
          await sqliteDb.run('INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)', [result.lastID, sub.id]);
        }
      }

      const token = jwt.sign({ id: result.lastID, usn: upperUsn, role }, JWT_SECRET, { expiresIn: '1d' });
      res.cookie('auth_token', token, { httpOnly: true, maxAge: 86400000 });
      return res.status(201).json({ success: true, user: { id: result.lastID, usn: upperUsn, name, role, email: lowerEmail } });
    }
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      if (err.message.includes('email')) {
        return res.status(400).json({ error: "Email address is already registered." });
      }
      return res.status(400).json({ error: "USN/Roll number is already registered." });
    }
    res.status(500).json({ error: err.message });
  }
});

// Login with Password
app.post('/api/auth/login-password', async (req, res) => {
  const { usn, password } = req.body;
  if (!usn || !password) {
    return res.status(400).json({ error: "Please enter USN and Password." });
  }

  try {
    const upperUsn = usn.trim().toUpperCase();
    let user;

    if (dbMode === 'firebase') {
      const doc = await firestoreDb.collection('users').doc(upperUsn).get();
      if (!doc.exists) return res.status(400).json({ error: "Invalid USN/ID." });
      user = doc.data();
      user.id = upperUsn;
    } else {
      user = await sqliteDb.get('SELECT * FROM users WHERE usn = ?', [upperUsn]);
      if (!user) return res.status(400).json({ error: "Invalid USN/ID." });
    }

    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) return res.status(400).json({ error: "Incorrect Password." });

    const token = jwt.sign({ id: user.id, usn: user.usn, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 86400000 });
    res.json({ success: true, user: { id: user.id, usn: user.usn, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: "Please enter USN or Email." });

  try {
    const isEmail = identifier.includes('@');
    const cleanIdent = identifier.trim();
    let user;

    if (dbMode === 'firebase') {
      const usersRef = firestoreDb.collection('users');
      let query;
      if (isEmail) {
        query = await usersRef.where('email', '==', cleanIdent.toLowerCase()).get();
      } else {
        query = await usersRef.where('usn', '==', cleanIdent.toUpperCase()).get();
      }
      if (query.empty) return res.status(400).json({ error: "User not found." });
      user = query.docs[0].data();
      user.id = query.docs[0].id;
    } else {
      if (isEmail) {
        user = await sqliteDb.get('SELECT * FROM users WHERE email = ?', [cleanIdent.toLowerCase()]);
      } else {
        user = await sqliteDb.get('SELECT * FROM users WHERE usn = ?', [cleanIdent.toUpperCase()]);
      }
      if (!user) return res.status(400).json({ error: "User not found." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000;

    if (dbMode === 'firebase') {
      await firestoreDb.collection('users').doc(user.id).update({ otp, otp_expiry: expiry });
    } else {
      await sqliteDb.run('UPDATE users SET otp = ?, otp_expiry = ? WHERE id = ?', [otp, expiry, user.id]);
    }

    await sendOTPEmail(user.email, user.usn, otp);

    res.json({ success: true, message: `OTP sent successfully.`, email: user.email, simulatedOtp: otp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login with OTP
app.post('/api/auth/login-otp', async (req, res) => {
  const { identifier, otp } = req.body;
  if (!identifier || !otp) {
    return res.status(400).json({ error: "Please enter USN/Email and OTP." });
  }

  try {
    const isEmail = identifier.includes('@');
    const cleanIdent = identifier.trim();
    let user;

    if (dbMode === 'firebase') {
      const usersRef = firestoreDb.collection('users');
      let query;
      if (isEmail) {
        query = await usersRef.where('email', '==', cleanIdent.toLowerCase()).get();
      } else {
        query = await usersRef.where('usn', '==', cleanIdent.toUpperCase()).get();
      }
      if (query.empty) return res.status(400).json({ error: "User not found." });
      user = query.docs[0].data();
      user.id = query.docs[0].id;
    } else {
      if (isEmail) {
        user = await sqliteDb.get('SELECT * FROM users WHERE email = ?', [cleanIdent.toLowerCase()]);
      } else {
        user = await sqliteDb.get('SELECT * FROM users WHERE usn = ?', [cleanIdent.toUpperCase()]);
      }
      if (!user) return res.status(400).json({ error: "User not found." });
    }

    if (!user.otp || user.otp !== otp.trim() || Date.now() > user.otp_expiry) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    if (dbMode === 'firebase') {
      await firestoreDb.collection('users').doc(user.id).update({ otp: null, otp_expiry: null });
    } else {
      await sqliteDb.run('UPDATE users SET otp = NULL, otp_expiry = NULL WHERE id = ?', [user.id]);
    }

    const token = jwt.sign({ id: user.id, usn: user.usn, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 86400000 });
    res.json({ success: true, user: { id: user.id, usn: user.usn, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  const { identifier, otp, new_password } = req.body;
  if (!identifier || !otp || !new_password) {
    return res.status(400).json({ error: "Please enter required fields." });
  }

  try {
    const isEmail = identifier.includes('@');
    const cleanIdent = identifier.trim();
    let user;

    if (dbMode === 'firebase') {
      const usersRef = firestoreDb.collection('users');
      let query;
      if (isEmail) {
        query = await usersRef.where('email', '==', cleanIdent.toLowerCase()).get();
      } else {
        query = await usersRef.where('usn', '==', cleanIdent.toUpperCase()).get();
      }
      if (query.empty) return res.status(400).json({ error: "User not found." });
      user = query.docs[0].data();
      user.id = query.docs[0].id;
    } else {
      if (isEmail) {
        user = await sqliteDb.get('SELECT * FROM users WHERE email = ?', [cleanIdent.toLowerCase()]);
      } else {
        user = await sqliteDb.get('SELECT * FROM users WHERE usn = ?', [cleanIdent.toUpperCase()]);
      }
      if (!user) return res.status(400).json({ error: "User not found." });
    }

    if (!user.otp || user.otp !== otp.trim() || Date.now() > user.otp_expiry) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    const password_hash = await bcrypt.hash(new_password, 10);

    if (dbMode === 'firebase') {
      await firestoreDb.collection('users').doc(user.id).update({ password_hash, otp: null, otp_expiry: null });
    } else {
      await sqliteDb.run('UPDATE users SET password_hash = ?, otp = NULL, otp_expiry = NULL WHERE id = ?', [password_hash, user.id]);
    }

    res.json({ success: true, message: "Password updated successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// Get session profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    let user;
    if (dbMode === 'firebase') {
      const doc = await firestoreDb.collection('users').doc(req.user.id).get();
      user = doc.data();
      if (user) user.id = doc.id;
    } else {
      user = await sqliteDb.get('SELECT id, usn, name, role, email FROM users WHERE id = ?', [req.user.id]);
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// COURSE MANAGEMENT & SUBJECTS
// ==========================================

// Get subjects list
app.get('/api/subjects', authenticateToken, async (req, res) => {
  try {
    let subjects = [];
    if (dbMode === 'firebase') {
      const snap = await firestoreDb.collection('subjects').get();
      snap.forEach(doc => {
        subjects.push(doc.data());
      });
      // In student role, filter by enrollment (if mock student, display all for simplicity)
    } else {
      if (req.user.role === 'student') {
        subjects = await sqliteDb.all(`
          SELECT s.* FROM subjects s 
          JOIN enrollments e ON s.id = e.subject_id 
          WHERE e.student_id = ?
        `, [req.user.id]);
      } else {
        subjects = await sqliteDb.all('SELECT * FROM subjects');
      }
    }
    res.json({ subjects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add subject (Admin endpoint)
app.post('/api/subjects', authenticateToken, async (req, res) => {
  const { name, code, target, color, teacher_id } = req.body;
  if (!name || !code) return res.status(400).json({ error: "Missing required details." });

  try {
    if (dbMode === 'firebase') {
      const id = `sub-${Date.now()}`;
      const newSubject = { id, name, code, target: target || 75, color: color || 'hsl(245, 82%, 67%)', teacher_id: teacher_id || 'SGBIT-TEA-01' };
      await firestoreDb.collection('subjects').doc(id).set(newSubject);
      return res.status(201).json({ success: true, subject: newSubject });
    } else {
      const result = await sqliteDb.run(
        'INSERT INTO subjects (name, code, target, color, teacher_id) VALUES (?, ?, ?, ?, ?)',
        [name, code, target || 75, color || 'hsl(245, 82%, 67%)', teacher_id]
      );
      
      // Auto enroll students
      const studs = await sqliteDb.all("SELECT id FROM users WHERE role = 'student'");
      for (const st of studs) {
        await sqliteDb.run('INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)', [st.id, result.lastID]);
      }

      return res.status(201).json({ success: true, subject: { id: result.lastID, name, code, target, color } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Subject (Admin endpoint)
app.delete('/api/subjects/:id', authenticateToken, async (req, res) => {
  try {
    if (dbMode === 'firebase') {
      await firestoreDb.collection('subjects').doc(req.params.id).delete();
    } else {
      await sqliteDb.run('DELETE FROM subjects WHERE id = ?', [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ATTENDANCE LOGGING & MEDICAL UPLOADS
// ==========================================

// Get personal attendance logs
app.get('/api/logs', authenticateToken, async (req, res) => {
  try {
    let logs = [];
    if (dbMode === 'firebase') {
      const snap = await firestoreDb.collection('attendance')
        .where('student_id', '==', req.user.id)
        .get();
      
      const subsSnap = await firestoreDb.collection('subjects').get();
      const subMap = {};
      subsSnap.forEach(d => { subMap[d.id] = d.data(); });

      snap.forEach(doc => {
        const item = doc.data();
        const sub = subMap[item.subject_id] || {};
        logs.push({
          id: doc.id,
          ...item,
          subject_name: sub.name || 'Subject',
          subject_color: sub.color || 'var(--primary)'
        });
      });
    } else {
      logs = await sqliteDb.all(`
        SELECT a.*, s.name as subject_name, s.color as subject_color 
        FROM attendance a 
        JOIN subjects s ON a.subject_id = s.id 
        WHERE a.student_id = ?
      `, [req.user.id]);
    }
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Roll-call Attendance (Supports file upload to Firebase Storage or local uploads/)
app.post('/api/logs', authenticateToken, upload.single('medical_certificate'), async (req, res) => {
  const { subject_id, date, status, student_override_id } = req.body;
  if (!subject_id || !date || !status) {
    return res.status(400).json({ error: "Missing parameters." });
  }

  const targetStudentId = req.user.role === 'teacher' && student_override_id ? student_override_id : req.user.id;

  try {
    let certificatePath = null;

    if (req.file) {
      if (dbMode === 'firebase') {
        // Stream file straight to Google Cloud Storage
        const fileUpload = bucket.file(`medical_certificates/${Date.now()}-${req.file.originalname}`);
        await fileUpload.save(fs.readFileSync(req.file.path), {
          contentType: req.file.mimetype,
          public: true
        });
        certificatePath = fileUpload.publicUrl();
        // Remove local file
        fs.unlinkSync(req.file.path);
      } else {
        certificatePath = `/uploads/${req.file.filename}`;
      }
    }

    if (dbMode === 'firebase') {
      const docId = `${targetStudentId}_${subject_id}_${date}`;
      await firestoreDb.collection('attendance').doc(docId).set({
        student_id: targetStudentId,
        subject_id,
        date,
        status,
        medical_certificate: certificatePath
      }, { merge: true });
    } else {
      await sqliteDb.run(`
        INSERT INTO attendance (student_id, subject_id, date, status, medical_certificate) 
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(student_id, subject_id, date) 
        DO UPDATE SET status = excluded.status, medical_certificate = COALESCE(excluded.medical_certificate, attendance.medical_certificate)
      `, [targetStudentId, subject_id, date, status, certificatePath]);
    }

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete specific roll log
app.delete('/api/logs/:id', authenticateToken, async (req, res) => {
  try {
    if (dbMode === 'firebase') {
      await firestoreDb.collection('attendance').doc(req.params.id).delete();
    } else {
      await sqliteDb.run('DELETE FROM attendance WHERE id = ?', [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset logs
app.post('/api/logs/reset', authenticateToken, async (req, res) => {
  try {
    if (dbMode === 'firebase') {
      const batch = firestoreDb.batch();
      const snap = await firestoreDb.collection('attendance').where('student_id', '==', req.user.id).get();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } else {
      await sqliteDb.run('DELETE FROM attendance WHERE student_id = ?', [req.user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
} );

// ==========================================
// ROSTER & USERS MANAGEMENT (For Teachers & Admins)
// ==========================================

// Get Roster Students List
app.get('/api/students', authenticateToken, async (req, res) => {
  try {
    let list = [];
    if (dbMode === 'firebase') {
      const snap = await firestoreDb.collection('users').where('role', '==', 'student').get();
      
      for (const d of snap.docs) {
        const st = d.data();
        // Calculate attendance summary
        const attSnap = await firestoreDb.collection('attendance').where('student_id', '==', d.id).get();
        let attended = 0;
        let total = 0;
        
        attSnap.forEach(doc => {
          const item = doc.data();
          if (item.status === 'present' || item.status === 'late' || item.status === 'medical') {
            attended++;
            total++;
          } else if (item.status === 'absent') {
            total++;
          }
        });

        list.push({
          id: d.id,
          name: st.name,
          roll_number: st.usn,
          attended,
          total
        });
      }
    } else {
      list = await sqliteDb.all(`
        SELECT u.id, u.name, u.usn as roll_number,
          (SELECT COUNT(*) FROM attendance a WHERE a.student_id = u.id AND (a.status = 'present' OR a.status = 'late' OR a.status = 'medical')) as attended,
          (SELECT COUNT(*) FROM attendance a WHERE a.student_id = u.id AND a.status != 'holiday' AND a.status != 'cancelled') as total
      FROM users u
      WHERE u.role = 'student'
      `);
    }
    res.json({ students: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Faculty List (For Admin portal)
app.get('/api/admin/faculty', authenticateToken, async (req, res) => {
  try {
    let faculty = [];
    if (dbMode === 'firebase') {
      const snap = await firestoreDb.collection('users').where('role', '==', 'teacher').get();
      snap.forEach(d => {
        const item = d.data();
        faculty.push({ id: d.id, usn: item.usn, name: item.name, email: item.email });
      });
    } else {
      faculty = await sqliteDb.all("SELECT id, usn, name, email FROM users WHERE role = 'teacher'");
    }
    res.json({ faculty });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Add Faculty
app.post('/api/admin/faculty', authenticateToken, async (req, res) => {
  const { name, usn, email, password } = req.body;
  if (!name || !usn || !email || !password) return res.status(400).json({ error: "Missing required fields." });

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const upperUsn = usn.trim().toUpperCase();
    const lowerEmail = email.trim().toLowerCase();

    if (dbMode === 'firebase') {
      const userRef = firestoreDb.collection('users').doc(upperUsn);
      await userRef.set({ usn: upperUsn, name, email: lowerEmail, password_hash, role: 'teacher' });
    } else {
      await sqliteDb.run(
        'INSERT INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [upperUsn, name, lowerEmail, password_hash, 'teacher']
      );
    }
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user (Student or Faculty)
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    if (dbMode === 'firebase') {
      await firestoreDb.collection('users').doc(req.params.id).delete();
    } else {
      await sqliteDb.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Faculty logs student roster roll call
app.post('/api/roster/attendance', authenticateToken, async (req, res) => {
  const { student_id, subject_id, date, status } = req.body;
  if (!student_id || !subject_id || !date || !status) {
    return res.status(400).json({ error: "Missing parameters." });
  }

  try {
    if (dbMode === 'firebase') {
      const docId = `${student_id}_${subject_id}_${date}`;
      await firestoreDb.collection('attendance').doc(docId).set({
        student_id,
        subject_id,
        date,
        status
      }, { merge: true });
    } else {
      await sqliteDb.run(`
        INSERT INTO attendance (student_id, subject_id, date, status) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(student_id, subject_id, date) 
        DO UPDATE SET status = excluded.status
      `, [student_id, subject_id, date, status]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add multiple students via CSV Import (For Faculty & Admin portals)
app.post('/api/students/import-csv', authenticateToken, async (req, res) => {
  const { students } = req.body; // Array of { name, roll_number }
  if (!students || !Array.isArray(students)) {
    return res.status(400).json({ error: "Invalid CSV data format." });
  }

  try {
    const defaultPassword = await bcrypt.hash('password123', 10);
    
    if (dbMode === 'firebase') {
      const batch = firestoreDb.batch();
      const allSubjects = await firestoreDb.collection('subjects').get();

      for (const st of students) {
        const upperRoll = st.roll_number.trim().toUpperCase();
        const mockEmail = `${st.name.toLowerCase().replace(/\s+/g, '')}@sgbit.edu.in`;
        
        const userRef = firestoreDb.collection('users').doc(upperRoll);
        batch.set(userRef, {
          usn: upperRoll,
          name: st.name.trim(),
          email: mockEmail,
          password_hash: defaultPassword,
          role: 'student'
        });
      }
      await batch.commit();
    } else {
      // SQLite Batch inserts
      await sqliteDb.run('BEGIN TRANSACTION');
      const allSubjects = await sqliteDb.all('SELECT id FROM subjects');

      for (const st of students) {
        const upperRoll = st.roll_number.trim().toUpperCase();
        const mockEmail = `${st.name.toLowerCase().replace(/\s+/g, '')}@sgbit.edu.in`;

        const result = await sqliteDb.run(
          'INSERT OR IGNORE INTO users (usn, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
          [upperRoll, st.name.trim(), mockEmail, defaultPassword, 'student']
        );

        // Auto enroll
        const insertedId = result.lastID || (await sqliteDb.get('SELECT id FROM users WHERE usn = ?', [upperRoll])).id;
        for (const sub of allSubjects) {
          await sqliteDb.run('INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)', [insertedId, sub.id]);
        }
      }
      await sqliteDb.run('COMMIT');
    }

    res.json({ success: true, message: `Successfully registered ${students.length} students to roster!` });
  } catch (err) {
    if (dbMode !== 'firebase') await sqliteDb.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Launch server
async function start() {
  await initMailer();
  await initDatabases();
  if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`🎓 SGBIT Unified Cloud ERP active: http://localhost:${PORT}`);
      console.log(`=======================================================`);
    });
  }
}

start();

module.exports = app;
