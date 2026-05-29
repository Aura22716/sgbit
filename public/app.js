// ==========================================
// CLIENT STATE ENGINE
// ==========================================
let ClientState = {
  user: null, // { id, usn, name, role }
  subjects: [],
  logs: [],
  students: [],
  faculty: [],
  calendar: {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    selectedDate: new Date().toISOString().split('T')[0]
  }
};

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-wrapper');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} glass`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// API SYNCHRONIZATION CALLS
// ==========================================
async function apiCall(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Something went wrong.");
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// ==========================================
// SESSION CHECK & ROUTING
// ==========================================
async function checkSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        ClientState.user = data.user;
        showWorkspace();
        return;
      }
    }
    showAuth();
  } catch (err) {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

function showWorkspace() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';

  // Set Profile Name and USN
  document.getElementById('user-profile-name').textContent = ClientState.user.name;
  document.getElementById('user-profile-usn').textContent = `ID: ${ClientState.user.usn}`;
  
  const initials = ClientState.user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('avatar-letters').textContent = initials;

  // Toggle View depending on Role
  const role = ClientState.user.role;
  const panelStudent = document.getElementById('panel-student');
  const panelTeacher = document.getElementById('panel-teacher');
  const panelAdmin = document.getElementById('panel-admin');
  
  const navSubjectsItem = document.getElementById('nav-subjects-item');
  const navSubjectsLabel = document.getElementById('nav-subjects-label');

  // Deactivate all panels
  panelStudent.classList.remove('active');
  panelTeacher.classList.remove('active');
  panelAdmin.classList.remove('active');

  if (role === 'student') {
    panelStudent.classList.add('active');
    navSubjectsItem.style.display = 'block';
    navSubjectsLabel.textContent = "My Subjects";
    
    document.getElementById('header-title').textContent = "Student Tracker";
    document.getElementById('header-subtitle').textContent = "Keep your attendance optimal and forecast skipping safely.";
    
    syncStudentData();
  } else if (role === 'teacher') {
    panelTeacher.classList.add('active');
    navSubjectsItem.style.display = 'block';
    navSubjectsLabel.textContent = "Class Subjects";
    
    document.getElementById('header-title').textContent = "Faculty Portal";
    document.getElementById('header-subtitle').textContent = "Manage class rosters, roll calls, and excuse approvals.";
    
    syncTeacherData();
  } else if (role === 'admin') {
    panelAdmin.classList.add('active');
    navSubjectsItem.style.display = 'none'; // Admins manage catalog centrally
    
    document.getElementById('header-title').textContent = "System Administration";
    document.getElementById('header-subtitle').textContent = "SGBIT master registry controls (Add faculty, define subjects).";
    
    syncAdminData();
  }
}

// ==========================================
// 👨‍🎓 STUDENT PANEL CONTROLLERS
// ==========================================
async function syncStudentData() {
  try {
    const subRes = await apiCall('/api/subjects');
    ClientState.subjects = subRes.subjects;

    const logRes = await apiCall('/api/logs');
    ClientState.logs = logRes.logs;

    renderStudentWorkspace();
  } catch (err) {
    console.error(err);
  }
}

function getStudentOverallStats() {
  let attended = 0;
  let total = 0;
  let absent = 0;

  ClientState.subjects.forEach(sub => {
    const subLogs = ClientState.logs.filter(l => l.subject_id === sub.id);
    subLogs.forEach(log => {
      if (log.status === 'present' || log.status === 'medical' || log.status === 'late') {
        attended++;
        total++;
      } else if (log.status === 'absent') {
        absent++;
        total++;
      }
    });
  });

  const percentage = total > 0 ? Math.round((attended / total) * 100) : 0;
  return { percentage, attended, total, absent };
}

function renderStudentWorkspace() {
  const stats = getStudentOverallStats();

  document.getElementById('student-total-percentage').textContent = `${stats.percentage}%`;
  document.getElementById('student-total-ratio').textContent = `${stats.attended}/${stats.total} Classes`;
  document.getElementById('student-total-attended').textContent = stats.attended;
  document.getElementById('student-total-absent').textContent = stats.absent;

  const container = document.getElementById('subjects-container');
  container.innerHTML = '';

  if (ClientState.subjects.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">
        <p>You are not enrolled in any SGBIT subjects. Ask Admin to enroll you.</p>
      </div>
    `;
    return;
  }

  ClientState.subjects.forEach(sub => {
    const subLogs = ClientState.logs.filter(l => l.subject_id === sub.id);
    let subAttended = 0;
    let subTotal = 0;
    
    subLogs.forEach(l => {
      if (l.status === 'present' || l.status === 'medical' || l.status === 'late') {
        subAttended++;
        subTotal++;
      } else if (l.status === 'absent') {
        subTotal++;
      }
    });

    const percent = subTotal > 0 ? Math.round((subAttended / subTotal) * 100) : 0;
    const offset = 201 - (percent / 100) * 201;

    const medicalBanner = percent < 75 && subTotal > 0 ? `
      <div class="danger-banner" onclick="openLogModal(${sub.id}, '${sub.name.replace(/'/g, "\\'")}', 'medical')" style="background: hsla(350, 89%, 60%, 0.08); color: var(--danger); border: 1px dashed var(--danger-glow); padding: 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; display: flex; align-items: center; gap: 0.35rem; cursor: pointer; margin-top: 0.75rem; text-align: center; font-weight: 600; justify-content: center;">
        <span>⚠️ Below 75%! Submit Medical Certificate to justify</span>
      </div>
    ` : '';

    const card = document.createElement('div');
    card.className = 'subject-card glass';
    card.style.setProperty('--subject-color', sub.color);
    card.innerHTML = `
      <div class="subject-top">
        <div class="subject-info-block">
          <span class="subject-title" title="${sub.name}">${sub.name}</span>
          <span class="subject-subtitle">${sub.code} • Target: ${sub.target}%</span>
        </div>
        <div class="progress-ring-container">
          <svg class="progress-ring-svg">
            <circle class="progress-ring-circle-bg" cx="35" cy="35" r="32" />
            <circle class="progress-ring-circle" cx="35" cy="35" r="32" style="stroke-dashoffset: ${offset};" />
          </svg>
          <span class="progress-percent">${percent}%</span>
        </div>
      </div>
      
      <div class="subject-stats-row">
        <div class="sub-stat-box">
          <span class="sub-stat-num" style="color: var(--success);">${subAttended}</span>
          <span class="sub-stat-lbl">Attended</span>
        </div>
        <div class="sub-stat-box">
          <span class="sub-stat-num">${subTotal}</span>
          <span class="sub-stat-lbl">Total</span>
        </div>
      </div>
      
      <div class="subject-actions">
        <button class="btn btn-primary btn-sm" style="flex-grow:1;" onclick="openLogModal(${sub.id}, '${sub.name.replace(/'/g, "\\'")}')">Record Roll</button>
      </div>
      ${medicalBanner}
    `;
    container.appendChild(card);
  });

  // Render Skip Simulator options
  const bunkSelector = document.getElementById('bunk-subject-selector');
  const prevVal = bunkSelector.value;
  bunkSelector.innerHTML = '<option value="">Choose a subject...</option>';
  ClientState.subjects.forEach(sub => {
    bunkSelector.innerHTML += `<option value="${sub.id}">${sub.name}</option>`;
  });
  if (prevVal && ClientState.subjects.find(s => s.id === parseInt(prevVal))) {
    bunkSelector.value = prevVal;
    calculateSmartBunk(parseInt(prevVal));
  } else {
    document.getElementById('bunk-slider-group').style.display = 'none';
    document.getElementById('bunk-analysis-card').style.display = 'none';
  }

  renderLogsList();
  renderCalendarWidget();
}

function calculateSmartBunk(subjectId, skipSimVal = 0) {
  const analysisCard = document.getElementById('bunk-analysis-card');
  const sliderGroup = document.getElementById('bunk-slider-group');
  
  const sub = ClientState.subjects.find(s => s.id === subjectId);
  if (!sub) {
    analysisCard.style.display = 'none';
    sliderGroup.style.display = 'none';
    return;
  }

  const subLogs = ClientState.logs.filter(l => l.subject_id === subjectId);
  let attended = 0;
  let total = 0;
  
  subLogs.forEach(l => {
    if (l.status === 'present' || l.status === 'medical' || l.status === 'late') {
      attended++;
      total++;
    } else if (l.status === 'absent') {
      total++;
    }
  });

  const target = sub.target / 100;
  const statusText = document.getElementById('bunk-status-text');
  const actionText = document.getElementById('bunk-action-text');
  
  const curPercentLbl = document.getElementById('bunk-current-percent');
  const simPercentLbl = document.getElementById('bunk-simulated-percent');

  if (total === 0) {
    sliderGroup.style.display = 'none';
    statusText.textContent = "No Records Yet";
    statusText.style.color = "var(--text-muted)";
    actionText.textContent = "Add your first attendance log to start predicting.";
    analysisCard.style.borderColor = "var(--glass-border)";
    analysisCard.style.display = 'flex';
    return;
  }

  sliderGroup.style.display = 'flex';

  const currentRate = attended / total;
  curPercentLbl.textContent = `${Math.round(currentRate * 100)}%`;

  const simTotal = total + skipSimVal;
  const simRate = attended / simTotal;
  
  simPercentLbl.textContent = `${Math.round(simRate * 100)}%`;

  if (simRate >= target) {
    simPercentLbl.style.color = 'var(--success)';
    const maxBunks = Math.floor(attended / target) - simTotal;
    if (maxBunks <= 0) {
      statusText.textContent = "Borderline Zone Alert";
      statusText.style.color = "var(--warning)";
      actionText.textContent = `Skipping ${skipSimVal} classes drops you to ${Math.round(simRate * 100)}%. Bunking even one more class drops you below ${sub.target}%.`;
      analysisCard.style.borderColor = "var(--warning)";
    } else {
      statusText.textContent = "Safe to Skip";
      statusText.style.color = "var(--success)";
      actionText.textContent = `You are safe! Even after skipping ${skipSimVal} classes, you can still bunk ${maxBunks} more classes consecutively before hitting ${sub.target}%.`;
      analysisCard.style.borderColor = "var(--success)";
    }
  } else {
    simPercentLbl.style.color = 'var(--danger)';
    const needed = Math.ceil((target * simTotal - attended) / (1 - target));
    statusText.textContent = "Critical Zone Alert";
    statusText.style.color = "var(--danger)";
    actionText.textContent = `Dangerous! Skipping ${skipSimVal} classes drags your rate down to ${Math.round(simRate * 100)}%. You will need to attend the next ${needed} classes consecutively to recover!`;
    analysisCard.style.borderColor = "var(--danger)";
  }

  analysisCard.style.display = 'flex';
}

function renderLogsList() {
  const container = document.getElementById('recent-logs-container');
  container.innerHTML = '';

  const sortedLogs = [...ClientState.logs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15);

  if (sortedLogs.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.85rem;">No recent records stored in cloud.</div>`;
    return;
  }

  sortedLogs.forEach(log => {
    const downloadLink = log.medical_certificate 
      ? `<a class="cert-link" href="${log.medical_certificate}" target="_blank">📄 View Medical Certificate</a>`
      : '';

    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
      <div class="log-info">
        <span class="log-subject">${log.subject_name}</span>
        <span class="log-date">${log.date} ${downloadLink}</span>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span class="badge badge-${log.status}">${log.status}</span>
        <button class="btn-icon-only btn-sm" onclick="deleteLog(${log.id})" style="width:28px; height:28px;"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg></button>
      </div>
    `;
    container.appendChild(div);
  });
}

// ==========================================
// 📅 CALENDAR WIDGET ENGINE
// ==========================================
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", 
  "July", "August", "September", "October", "November", "December"
];

function renderCalendarWidget() {
  const container = document.getElementById('calendar-widget-container');
  if (!container) return;

  const { currentYear, currentMonth, selectedDate } = ClientState.calendar;
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();

  let daysHTML = '';
  for (let i = 0; i < firstDay; i++) {
    daysHTML += `<div class="calendar-cell empty"></div>`;
  }

  for (let day = 1; day <= totalDays; day++) {
    const dayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dayStr === new Date().toISOString().split('T')[0] ? 'today' : '';
    const isSelected = dayStr === selectedDate ? 'selected' : '';

    const dayLogs = ClientState.logs.filter(l => l.date === dayStr);
    let dots = '';
    if (dayLogs.length > 0) {
      const statuses = dayLogs.map(l => l.status);
      if (statuses.includes('absent')) {
        dots = `<div class="calendar-dot-absent"></div>`;
      } else if (statuses.includes('present') || statuses.includes('medical') || statuses.includes('late')) {
        dots = `<div class="calendar-dot-present"></div>`;
      } else {
        dots = `<div class="calendar-dot-holiday"></div>`;
      }
    }

    daysHTML += `
      <div class="calendar-cell ${isToday} ${isSelected}" onclick="selectDate('${dayStr}')">
        <span>${day}</span>
        ${dots}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="calendar-header">
      <span class="calendar-month-year">${MONTH_NAMES[currentMonth]} ${currentYear}</span>
      <div class="calendar-nav">
        <button class="calendar-nav-btn" onclick="navigateCal(-1)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="calendar-nav-btn" onclick="navigateCal(1)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
    </div>
    <div class="calendar-days-grid">
      <div class="calendar-day-label">Su</div>
      <div class="calendar-day-label">Mo</div>
      <div class="calendar-day-label">Tu</div>
      <div class="calendar-day-label">We</div>
      <div class="calendar-day-label">Th</div>
      <div class="calendar-day-label">Fr</div>
      <div class="calendar-day-label">Sa</div>
      ${daysHTML}
    </div>
  `;
}

window.selectDate = function(dateStr) {
  ClientState.calendar.selectedDate = dateStr;
  renderCalendarWidget();
};

window.navigateCal = function(dir) {
  ClientState.calendar.currentMonth += dir;
  if (ClientState.calendar.currentMonth < 0) {
    ClientState.calendar.currentMonth = 11;
    ClientState.calendar.currentYear--;
  } else if (ClientState.calendar.currentMonth > 11) {
    ClientState.calendar.currentMonth = 0;
    ClientState.calendar.currentYear++;
  }
  renderCalendarWidget();
};

// ==========================================
// 👩‍🏫 FACULTY PORTAL CONTROLLERS
// ==========================================
async function syncTeacherData() {
  try {
    const studRes = await apiCall('/api/students');
    ClientState.students = studRes.students;

    const subRes = await apiCall('/api/subjects');
    ClientState.subjects = subRes.subjects;

    const logRes = await apiCall('/api/logs');
    ClientState.logs = logRes.logs;

    renderTeacherWorkspace();
  } catch (err) {
    console.error(err);
  }
}

function renderTeacherWorkspace() {
  const activeStudents = ClientState.students.length;
  
  let overallPercentageSum = 0;
  let onTargetCount = 0;
  let belowTargetCount = 0;

  ClientState.students.forEach(st => {
    const rate = st.total > 0 ? (st.attended / st.total) * 100 : 0;
    overallPercentageSum += rate;
    if (rate >= 75) onTargetCount++;
    else belowTargetCount++;
  });

  const avgPercentage = activeStudents > 0 ? Math.round(overallPercentageSum / activeStudents) : 0;

  document.getElementById('teacher-avg-percentage').textContent = `${avgPercentage}%`;
  document.getElementById('teacher-total-students-label').textContent = `${activeStudents} Active Students`;
  document.getElementById('teacher-on-target').textContent = onTargetCount;
  document.getElementById('teacher-low-attendance').textContent = belowTargetCount;

  // Filter teacher assigned subjects only
  const teacherSubSelector = document.getElementById('teacher-subject-selector');
  teacherSubSelector.innerHTML = '';
  ClientState.subjects.forEach(sub => {
    teacherSubSelector.innerHTML += `<option value="${sub.id}">${sub.name}</option>`;
  });

  const tbody = document.querySelector('#roster-table-body tbody');
  tbody.innerHTML = '';

  if (ClientState.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">Roster is empty. Add students or Import a CSV file to load database.</td>
      </tr>
    `;
    return;
  }

  ClientState.students.forEach(st => {
    const rate = st.total > 0 ? Math.round((st.attended / st.total) * 100) : 0;
    const isCritical = rate < 75 ? 'alert-roster-low' : '';

    // Check if student has medical leaves uploaded
    const studentLogs = ClientState.logs.filter(l => l.student_id === st.id && l.status === 'medical');
    const medicalBadge = studentLogs.length > 0
      ? `<br><a href="${studentLogs[0].medical_certificate}" target="_blank" class="cert-link" style="margin-top:0.2rem;">⚕️ Excused medical upload</a>`
      : '';

    const tr = document.createElement('tr');
    tr.className = isCritical;
    tr.innerHTML = `
      <td>
        <div class="student-meta-col">
          <span class="student-name">${st.name}</span>
          ${medicalBadge}
        </div>
      </td>
      <td><code>${st.roll_number}</code></td>
      <td>
        <span class="badge ${rate < 75 ? 'badge-absent' : 'badge-present'}">${rate}%</span>
      </td>
      <td>
        <div class="action-switch-group">
          <button class="switch-btn present" onclick="logTeacherRosterAttendance('${st.id}', 'present', this)">P</button>
          <button class="switch-btn absent" onclick="logTeacherRosterAttendance('${st.id}', 'absent', this)">A</button>
          <button class="switch-btn late" onclick="logTeacherRosterAttendance('${st.id}', 'late', this)">L</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.logTeacherRosterAttendance = async function(studentId, status, buttonEl) {
  const subjectId = document.getElementById('teacher-subject-selector').value;
  if (!subjectId) {
    showToast("Please register/select a subject first!", 'error');
    return;
  }

  try {
    await apiCall('/api/roster/attendance', {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        subject_id: subjectId,
        date: new Date().toISOString().split('T')[0],
        status
      })
    });
    
    const parent = buttonEl.parentElement;
    parent.querySelectorAll('.switch-btn').forEach(btn => btn.classList.remove('active'));
    buttonEl.classList.add('active');

    showToast(`Logged roll-call successfully!`);
    syncTeacherData();
  } catch (err) {
    console.error(err);
  }
};

// ==========================================
// 🏛️ MASTER ADMIN PANEL CONTROLLERS
// ==========================================
async function syncAdminData() {
  try {
    const subRes = await apiCall('/api/subjects');
    ClientState.subjects = subRes.subjects;

    const studRes = await apiCall('/api/students');
    ClientState.students = studRes.students;

    const facRes = await apiCall('/api/admin/faculty');
    ClientState.faculty = facRes.faculty;

    renderAdminWorkspace();
  } catch (err) {
    console.error(err);
  }
}

function renderAdminWorkspace() {
  // Update Counts
  document.getElementById('admin-total-teachers').textContent = ClientState.faculty.length;
  document.getElementById('admin-total-students').textContent = ClientState.students.length;
  document.getElementById('admin-total-subjects').textContent = ClientState.subjects.length;

  // Render Admin Subjects Table
  const subTbody = document.querySelector('#admin-subjects-table tbody');
  subTbody.innerHTML = '';
  
  ClientState.subjects.forEach(sub => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${sub.name}</strong></td>
      <td><code>${sub.code}</code></td>
      <td>${sub.teacher_id || 'Unassigned'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="adminDeleteSubject('${sub.id}')">Drop</button>
      </td>
    `;
    subTbody.appendChild(tr);
  });

  // Render Faculty List Table
  const facTbody = document.querySelector('#admin-faculty-table tbody');
  facTbody.innerHTML = '';

  ClientState.faculty.forEach(fac => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${fac.name}</strong></td>
      <td><code>${fac.usn}</code></td>
      <td>
        <button class="btn-icon-only btn-sm" onclick="adminDeleteUser('${fac.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg></button>
      </td>
    `;
    facTbody.appendChild(tr);
  });
}

window.adminDeleteSubject = async function(id) {
  if (confirm("Delete subject and delete enrollment bindings?")) {
    await apiCall(`/api/subjects/${id}`, { method: 'DELETE' });
    showToast("Subject removed.");
    syncAdminData();
  }
};

window.adminDeleteUser = async function(id) {
  if (confirm("Remove user registry permanently from campus SQL database?")) {
    await apiCall(`/api/admin/users/${id}`, { method: 'DELETE' });
    showToast("Faculty/Student account deleted.");
    syncAdminData();
  }
};

// ==========================================
// ⚕️ MEDICAL CERTIFICATE LOG MODAL
// ==========================================
window.openLogModal = function(subjectId, subjectName, defaultStatus = 'present') {
  document.getElementById('log-subject-id').value = subjectId;
  document.getElementById('log-subject-name').value = subjectName;
  document.getElementById('log-date-picker').value = ClientState.calendar.selectedDate;
  
  const statusSelect = document.getElementById('log-status-select');
  statusSelect.value = defaultStatus;
  statusSelect.dispatchEvent(new Event('change'));
  
  document.getElementById('modal-log-attendance').classList.add('active');
};

document.getElementById('log-status-select').addEventListener('change', (e) => {
  const uploadGroup = document.getElementById('medical-upload-group');
  if (e.target.value === 'medical') {
    uploadGroup.style.display = 'block';
  } else {
    uploadGroup.style.display = 'none';
  }
});

// Personal log roll submit
document.getElementById('form-log-attendance').addEventListener('submit', async (e) => {
  e.preventDefault();
  const subjectId = document.getElementById('log-subject-id').value;
  const date = document.getElementById('log-date-picker').value;
  const status = document.getElementById('log-status-select').value;
  const fileInput = document.getElementById('medical-file-input');

  const formData = new FormData();
  formData.append('subject_id', subjectId);
  formData.append('date', date);
  formData.append('status', status);
  if (status === 'medical' && fileInput.files[0]) {
    formData.append('medical_certificate', fileInput.files[0]);
  }

  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast("Roll status saved to Cloud Database!");
    document.getElementById('modal-log-attendance').classList.remove('active');
    document.getElementById('form-log-attendance').reset();
    document.getElementById('medical-upload-group').style.display = 'none';
    
    syncStudentData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

window.deleteLog = async function(id) {
  await apiCall(`/api/logs/${id}`, { method: 'DELETE' });
  showToast("Record removed.");
  syncStudentData();
};

// ==========================================
// 📊 CSV REAL DATA IMPORTER & EXPORTER
// ==========================================

// Parse CSV and batch register students (real-data connection!)
document.getElementById('form-csv-import').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('csv-file-input');
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(event) {
    const text = event.target.result;
    const lines = text.split('\n');
    const parsedStudents = [];

    lines.forEach(line => {
      const cols = line.split(',');
      if (cols.length >= 2 && cols[0].trim() !== '' && cols[1].trim() !== '') {
        parsedStudents.push({
          roll_number: cols[0].trim().toUpperCase(),
          name: cols[1].trim()
        });
      }
    });

    if (parsedStudents.length === 0) {
      showToast("Could not find any readable rows in CSV file.", "error");
      return;
    }

    try {
      const data = await apiCall('/api/students/import-csv', {
        method: 'POST',
        body: JSON.stringify({ students: parsedStudents })
      });
      showToast(data.message);
      document.getElementById('modal-csv-import').classList.remove('active');
      document.getElementById('form-csv-import').reset();
      
      if (ClientState.user.role === 'teacher') syncTeacherData();
      else syncAdminData();
    } catch (err) {}
  };

  reader.readAsText(file);
});

// Export Attendance Log spreadsheet (real data spreadsheet downloading!)
document.getElementById('btn-export-attendance').addEventListener('click', () => {
  if (ClientState.students.length === 0) {
    showToast("No student records available to export.", "error");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,USN,Student Name,Attended Sessions,Total Sessions,Attendance Rate%\n";
  ClientState.students.forEach(st => {
    const rate = st.total > 0 ? Math.round((st.attended / st.total) * 100) : 0;
    csvContent += `"${st.roll_number}","${st.name}",${st.attended},${st.total},"${rate}%"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `attendance_report_${Date.now()}.csv`);
  document.body.appendChild(link);
  
  link.click();
  link.remove();
  showToast("Attendance report downloaded successfully!");
});

// ==========================================
// INTERACTIVE WINDOW PAGE LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  checkSession();

  // Primary Login Selector Tabs
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLoginContainer = document.getElementById('form-login-container');
  const formRegister = document.getElementById('form-register');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLoginContainer.classList.add('active');
    formRegister.classList.remove('active');
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.classList.add('active');
    formLoginContainer.classList.remove('active');
  });

  // Login Sub-Tabs
  const tabPass = document.getElementById('sub-tab-password');
  const tabOtp = document.getElementById('sub-tab-otp');
  const formLoginPassword = document.getElementById('form-login-password');
  const formLoginOtp = document.getElementById('form-login-otp');

  tabPass.addEventListener('click', () => {
    tabPass.classList.add('active');
    tabOtp.classList.remove('active');
    formLoginPassword.classList.add('active');
    formLoginOtp.classList.remove('active');
  });

  tabOtp.addEventListener('click', () => {
    tabOtp.classList.add('active');
    tabPass.classList.remove('active');
    formLoginOtp.classList.add('active');
    formLoginPassword.classList.remove('active');
  });

  // Password Login Submission
  formLoginPassword.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usn = document.getElementById('login-usn').value;
    const password = document.getElementById('login-password').value;

    try {
      const data = await apiCall('/api/auth/login-password', {
        method: 'POST',
        body: JSON.stringify({ usn, password })
      });
      ClientState.user = data.user;
      showToast(`Welcome back, ${data.user.name}!`);
      showWorkspace();
    } catch (err) {}
  });

  // Request OTP trigger
  document.getElementById('btn-send-otp').addEventListener('click', async () => {
    const identifier = document.getElementById('login-otp-usn').value;
    if (!identifier) {
      showToast("Please enter your USN or Email first.", "error");
      return;
    }

    try {
      const data = await apiCall('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ identifier })
      });
      
      document.getElementById('otp-input-group').style.display = 'block';
      document.getElementById('btn-submit-otp').disabled = false;
      document.getElementById('otp-status-lbl').textContent = "OTP Dispatched.";

      alert(`[OTP Simulation Portal]\n\nA security code has been generated:\n\nOTP Code: ${data.simulatedOtp}\n\nEnter this code to log in!`);
    } catch (err) {}
  });

  // OTP Login submit
  formLoginOtp.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('login-otp-usn').value;
    const otp = document.getElementById('login-otp-code').value;

    try {
      const data = await apiCall('/api/auth/login-otp', {
        method: 'POST',
        body: JSON.stringify({ identifier, otp })
      });
      ClientState.user = data.user;
      showToast(`Logged in successfully!`);
      showWorkspace();
    } catch (err) {}
  });

  // Register Form Submit
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const usn = document.getElementById('reg-usn').value;
    const password = document.getElementById('reg-password').value;
    const role = document.getElementById('reg-role').value;

    try {
      const data = await apiCall('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, usn, password, role })
      });
      ClientState.user = data.user;
      showToast("Registration completed successfully!");
      showWorkspace();
    } catch (err) {}
  });

  // Logout Submit
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await apiCall('/api/auth/logout', { method: 'POST' });
    ClientState.user = null;
    showToast("Session closed.");
    showAuth();
  });

  // Toggle Theme
  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const newTheme = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    document.getElementById('theme-text').textContent = isLight ? "Light Mode" : "Dark Mode";
    document.getElementById('theme-sun-icon').style.display = isLight ? 'none' : 'block';
    document.getElementById('theme-moon-icon').style.display = isLight ? 'block' : 'none';
  });

  // Skip simulation slider input
  document.getElementById('bunk-subject-selector').addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('bunk-slider').value = 0;
    document.getElementById('bunk-slider-value').textContent = "0 Classes";
    calculateSmartBunk(val, 0);
  });

  document.getElementById('bunk-slider').addEventListener('input', (e) => {
    const skipVal = parseInt(e.target.value);
    const subId = parseInt(document.getElementById('bunk-subject-selector').value);
    document.getElementById('bunk-slider-value').textContent = `${skipVal} Classes`;
    calculateSmartBunk(subId, skipVal);
  });

  // Reset Logs
  document.getElementById('btn-clear-logs').addEventListener('click', async () => {
    if (confirm("Reset all personal database attendance logs back to empty state?")) {
      await apiCall('/api/logs/reset', { method: 'POST' });
      showToast("Logs dropped.");
      syncStudentData();
    }
  });

  // Student Subject Modal
  const modalSubject = document.getElementById('modal-add-subject');
  document.getElementById('btn-close-subject-modal').addEventListener('click', () => modalSubject.classList.remove('active'));
  document.getElementById('btn-cancel-subject').addEventListener('click', () => modalSubject.classList.remove('active'));

  let selectedColor = 'hsl(245, 82%, 67%)';
  document.querySelectorAll('#subject-color-picker .color-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      document.querySelectorAll('#subject-color-picker .color-option').forEach(o => o.classList.remove('selected'));
      e.target.classList.add('selected');
      selectedColor = e.target.getAttribute('data-color');
    });
  });

  // Admin add subject modal submit
  document.getElementById('form-add-subject').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('subject-name-input').value;
    const code = document.getElementById('subject-code-input').value;
    const target = parseInt(document.getElementById('subject-target-input').value);
    const teacher_id = document.getElementById('subject-teacher-select').value;

    try {
      await apiCall('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name, code, target, color: selectedColor, teacher_id })
      });
      showToast(`Subject registered.`);
      modalSubject.classList.remove('active');
      document.getElementById('form-add-subject').reset();
      syncAdminData();
    } catch (err) {}
  });

  // Teacher Add Student Modal
  const modalStudent = document.getElementById('modal-add-student');
  document.getElementById('btn-add-student-modal').addEventListener('click', () => modalStudent.classList.add('active'));
  document.getElementById('btn-close-student-modal').addEventListener('click', () => modalStudent.classList.remove('active'));
  document.getElementById('btn-cancel-student').addEventListener('click', () => modalStudent.classList.remove('active'));

  document.getElementById('form-add-student').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('student-name-input').value;
    const roll_number = document.getElementById('student-roll-input').value;

    try {
      await apiCall('/api/students', {
        method: 'POST',
        body: JSON.stringify({ name, roll_number })
      });
      showToast(`Registered ${name} to SGBIT registry.`);
      modalStudent.classList.remove('active');
      document.getElementById('form-add-student').reset();
      
      if (ClientState.user.role === 'teacher') syncTeacherData();
      else syncAdminData();
    } catch (err) {}
  });

  // Admin Modals (Add Faculty, Add Subject)
  const modalAdminFaculty = document.getElementById('modal-admin-add-faculty');
  document.getElementById('btn-admin-add-faculty').addEventListener('click', () => modalAdminFaculty.classList.add('active'));
  document.getElementById('btn-close-admin-faculty').addEventListener('click', () => modalAdminFaculty.classList.remove('active'));
  document.getElementById('btn-cancel-admin-faculty').addEventListener('click', () => modalAdminFaculty.classList.remove('active'));

  document.getElementById('form-admin-add-faculty').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('faculty-name-input').value;
    const usn = document.getElementById('faculty-code-input').value;
    const email = document.getElementById('faculty-email-input').value;
    const password = document.getElementById('faculty-password-input').value;

    try {
      await apiCall('/api/admin/faculty', {
        method: 'POST',
        body: JSON.stringify({ name, usn, email, password })
      });
      showToast(`Successfully registered faculty member Prof. ${name}`);
      modalAdminFaculty.classList.remove('active');
      document.getElementById('form-admin-add-faculty').reset();
      syncAdminData();
    } catch (err) {}
  });

  document.getElementById('btn-admin-add-subject').addEventListener('click', () => {
    // Populate teachers list in selector
    const select = document.getElementById('subject-teacher-select');
    select.innerHTML = '';
    ClientState.faculty.forEach(fac => {
      select.innerHTML += `<option value="${fac.usn}">${fac.name} (${fac.usn})</option>`;
    });
    modalSubject.classList.add('active');
  });

  // CSV Dialog controls
  const modalCsv = document.getElementById('modal-csv-import');
  document.getElementById('btn-import-roster-csv').addEventListener('click', () => modalCsv.classList.add('active'));
  document.getElementById('btn-close-csv').addEventListener('click', () => modalCsv.classList.remove('active'));
  document.getElementById('btn-cancel-csv').addEventListener('click', () => modalCsv.classList.remove('active'));

  // Forgot password triggers
  const modalReset = document.getElementById('modal-reset-password');
  const btnForgot = document.getElementById('btn-forgot-password-link');
  const btnCloseReset = document.getElementById('btn-close-reset-modal');
  const btnCancelReset = document.getElementById('btn-cancel-reset');
  const formReset = document.getElementById('form-reset-password');
  const btnSendResetOtp = document.getElementById('btn-send-reset-otp');

  btnForgot.addEventListener('click', (e) => {
    e.preventDefault();
    modalReset.classList.add('active');
  });

  const closeResetModal = () => {
    modalReset.classList.remove('active');
    formReset.reset();
    document.getElementById('reset-otp-input-group').style.display = 'none';
    document.getElementById('reset-new-password-group').style.display = 'none';
    document.getElementById('btn-submit-reset').disabled = true;
    document.getElementById('reset-otp-status-lbl').textContent = "Request a 6-digit verification code.";
  };

  btnCloseReset.addEventListener('click', closeResetModal);
  btnCancelReset.addEventListener('click', closeResetModal);

  // Send Reset OTP
  btnSendResetOtp.addEventListener('click', async () => {
    const identifier = document.getElementById('reset-identifier').value;
    if (!identifier) {
      showToast("Please enter your USN or Email first.", "error");
      return;
    }

    try {
      const data = await apiCall('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ identifier })
      });

      document.getElementById('reset-otp-input-group').style.display = 'block';
      document.getElementById('reset-new-password-group').style.display = 'block';
      document.getElementById('btn-submit-reset').disabled = false;
      document.getElementById('reset-otp-status-lbl').textContent = `OTP dispatched to registered email.`;

      alert(`[OTP Password Reset]\n\nA security code has been generated:\n\nOTP Code: ${data.simulatedOtp}\n\nPlease enter this code to reset your password!`);
    } catch (err) {}
  });

  formReset.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('reset-identifier').value;
    const otp = document.getElementById('reset-otp-code').value;
    const new_password = document.getElementById('reset-new-password').value;

    if (new_password.length < 6) {
      showToast("New password must be at least 6 characters.", "error");
      return;
    }

    try {
      const data = await apiCall('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ identifier, otp, new_password })
      });
      showToast(data.message, 'success');
      closeResetModal();
    } catch (err) {}
  });

  // Close personal logs
  document.getElementById('btn-close-log-modal').addEventListener('click', () => document.getElementById('modal-log-attendance').classList.remove('active'));
  document.getElementById('btn-cancel-log').addEventListener('click', () => document.getElementById('modal-log-attendance').classList.remove('active'));
});
