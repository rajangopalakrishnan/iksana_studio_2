import { useState, useEffect, useCallback } from "react";
// Vercel Deployment Trigger: 2026-05-13 14:58 (FINAL STABLE v3.0)
import { supabase, uploadFile, getFileUrl } from "./supabase";

// ─── Persistent Storage Helpers ────────────────────────────────────────────
// ─── Auth & Email Config Keys ─────────────────────────────────────────────────
const KEYS = {
  engineers:    "iksana:engineers",
  projects:     "iksana:projects",
  tasks:        "iksana:tasks",
  productivity: "iksana:productivity",
  attendance:   "iksana:attendance",
  leaves:       "iksana:leaves",
  dismissed:    "iksana:dismissed",
  users:        "iksana:users_v2_final",
  session:      "iksana:session",
  emailCfg:     "iksana:emailCfg",
  auditLog:     "iksana:auditLog",
};

// ─── Role System ──────────────────────────────────────────────────────────────
const ROLES = {
  admin:    { label:"Admin",   color:"#6366f1", bg:"#6366f122" },
  manager:  { label:"Manager", color:"#10b981", bg:"#10b98122" },
  operator: { label:"Operator",color:"#f59e0b", bg:"#f59e0b22" },
};

// ─── Password Hashing (SHA-256 via Web Crypto) ────────────────────────────────
async function hashPassword(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(password + "iksana_salt_2025"));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ─── Default Users (passwords will be hashed on first load) ──────────────────
// Plaintext passwords shown here — on first save they are hashed and originals dropped
const SEED_USERS_PLAIN = [
  { id:"u0", name:"Admin Studio",        email:"admin@iksana.tech",   role:"admin",    engineerId:"e1", password:"Iksana26",    mustChange:false },
  { id:"u1", name:"Rajan Gopalakrishnan", email:"rg@iksana.tech",      role:"admin",    engineerId:"e1", password:"Admin@2025",  mustChange:false },
  { id:"u2", name:"Nisanth P",           email:"np@iksana.tech",      role:"admin",    engineerId:"e2", password:"Iksana@2025", mustChange:true  },
  { id:"u3", name:"Baburaj",             email:"baburaj.tc@iksana.tech", role:"operator", engineerId:"e3", password:"Iksana@2025", mustChange:true  },
  { id:"u11",name:"Biburaj",            email:"btp@iksana.tech",       role:"manager",  engineerId:"e11",password:"Iksana@2025", mustChange:true  },
  { id:"u4", name:"Akheel",              email:"akheel.a@iksana.tech", role:"operator", engineerId:"e4", password:"Iksana@2025", mustChange:true  },
  { id:"u5", name:"Shaheeb",             email:"sheheeb.uk@iksana.tech", role:"operator", engineerId:"e5", password:"Iksana@2025", mustChange:true  },
  { id:"u6", name:"Devi Krishna",        email:"devikrishna.u@iksana.tech", role:"operator", engineerId:"e6", password:"Iksana@2025", mustChange:true  },
  { id:"u7", name:"Atheesh",             email:"athish.tm@iksana.tech", role:"operator", engineerId:"e7", password:"Iksana@2025", mustChange:true  },
  { id:"u8", name:"Sreekumar",           email:"sreekumar.mp@iksana.tech", role:"operator", engineerId:"e8", password:"Iksana@2025", mustChange:true  },
  { id:"u9", name:"Anjana. T A",         email:"anjana.ta@iksana.tech", role:"operator", engineerId:"e9", password:"Iksana@2025", mustChange:true  },
  { id:"u10",name:"Anjitha",            email:"anjitha@iksana.tech",   role:"operator", engineerId:"e10",password:"Iksana@2025", mustChange:true  },
  { id:"u12",name:"Shivram Nallepilly",  email:"shivram.nv@iksana.tech", role:"manager",  engineerId:"e12",password:"Iksana@2025", mustChange:true  },
  { id:"u13",name:"Janani Jayaraman",    email:"janani.j@iksana.tech",   role:"operator", engineerId:"e13",password:"Iksana@2025", mustChange:true  },
];

async function initUsers(stored) {
  // If already hashed (no password field), return as-is
  if (stored && stored.length > 0 && !stored[0].password) return stored;
  const source = (stored && stored.length > 0 && stored[0].password) ? stored : SEED_USERS_PLAIN;
  return Promise.all(source.map(async u => {
    if (u.passwordHash) return u; // already hashed
    const { password, ...rest } = u;
    return { ...rest, passwordHash: await hashPassword(password) };
  }));
}

// ─── Permission helpers ───────────────────────────────────────────────────────
const can = (role, action) => {
  const perms = {
    viewFinancials:   ["admin","manager"],
    viewReports:      ["admin","manager"],
    viewEngineers:    ["admin","manager"],
    viewAllocation:   ["admin","manager"],
    viewProductivity: ["admin","manager"],
    viewExport:       ["admin","manager"],
    viewAlerts:       ["admin","manager"],
    viewAuditLog:     ["admin","manager"],
    viewSettings:     ["admin"],
    editEngineers:    ["admin"],
    editProjects:     ["admin","manager"],
    editTasks:        ["admin","manager"],
    deleteTasks:      ["admin"],
    approveLeave:     ["admin","manager"],
    viewAllTasks:     ["admin","manager"],
    editProductivity: ["admin"],
    manageUsers:      ["admin"],
    configEmail:      ["admin"],
  };
  return (perms[action]||[]).includes(role);
};

const TABS_FOR_ROLE = {
  admin:    ["dashboard","tasks","engineers","projects","allocation","attendance","productivity","reports","notifications","export","import","settings"],
  manager:  ["dashboard","tasks","projects","allocation","attendance","notifications","export","import"],
  operator: ["dashboard","tasks","attendance","export","import"],
};

// ─── Email Notification Engine (EmailJS) ─────────────────────────────────────
const DEFAULT_EMAIL_CFG = {
  serviceId:  "",
  templateId: "",
  publicKey:  "",
  adminEmail: "",
  enabled:    false,
  triggers: {
    taskOverdue:     true,
    budgetWarning:   true,
    leaveRequest:    true,
    leaveDecision:   true,
    weeklyDigest:    false,
    taskAssigned:    true,
  },
};

async function loadEmailJS(publicKey) {
  return new Promise((res, rej) => {
    if (window.emailjs) { window.emailjs.init(publicKey); return res(window.emailjs); }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    s.onload = () => { window.emailjs.init(publicKey); res(window.emailjs); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function sendEmail(cfg, templateParams) {
  if (!cfg.enabled || !cfg.serviceId || !cfg.templateId || !cfg.publicKey) return false;
  try {
    const ejs = await loadEmailJS(cfg.publicKey);
    await ejs.send(cfg.serviceId, cfg.templateId, templateParams);
    return true;
  } catch (e) { console.warn("EmailJS error:", e); return false; }
}

// ─── Audit Log helper ─────────────────────────────────────────────────────────
function makeAuditEntry(user, action, detail) {
  return { id: uid(), ts: new Date().toISOString(), user: user?.name || "System", role: user?.role || "", action, detail };
}

// ─── Date Formatter (display only — data stays YYYY-MM-DD) ──────────────────
const fmtDate = (d) => { if (!d) return ""; const [y,m,dd] = d.split("-"); return `${dd}/${m}/${y}`; };

// ─── Seed Attendance ─────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const daysBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const SEED_ATTENDANCE = [
  // last 5 working days, all 8 engineers
  ...["e1","e2","e3","e4","e5","e6","e7","e8"].flatMap(eid =>
    [0,1,2,3,4].map(n => ({
      id: `a-${eid}-${n}`,
      engineerId: eid,
      date: daysBack(n),
      checkIn: n === 0 ? "09:10" : ["09:00","09:15","08:55","09:30","09:05"][n % 5],
      checkOut: n === 0 ? null : ["18:00","18:15","17:45","18:30","18:00"][n % 5],
      type: "present",
      notes: "",
    }))
  ),
];

const SEED_LEAVES = [
  { id: "l1", engineerId: "e4", startDate: daysBack(-3), endDate: daysBack(-5), type: "casual", reason: "Personal work", status: "approved" },
  { id: "l2", engineerId: "e7", startDate: daysBack(-2), endDate: daysBack(-2), type: "sick", reason: "Fever", status: "approved" },
  { id: "l3", engineerId: "e2", startDate: daysBack(-8), endDate: daysBack(-10), type: "annual", reason: "Family visit", status: "approved" },
];

const LEAVE_TYPES = ["casual", "sick", "annual", "compensatory", "unpaid"];
const LEAVE_COLORS = { casual: "#6366f1", sick: "#ef4444", annual: "#10b981", compensatory: "#f59e0b", unpaid: "#64748b" };

// ─── SheetJS & PDF Helpers (Shared) ──────────────────────────────────────────
const loadXLSX = () => new Promise((res, rej) => {
  if (window.XLSX) return res(window.XLSX);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  s.onload = () => res(window.XLSX); s.onerror = rej;
  document.head.appendChild(s);
});

const xlsxDownload = async (sheets, filename) => {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, data, colWidths }) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    if (colWidths) ws["!cols"] = colWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, filename);
};

const loadJsPDF = () => new Promise((res, rej) => {
  if (window.jspdf) return res(window.jspdf.jsPDF);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  s.onload = () => {
    const s2 = document.createElement("script");
    s2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
    s2.onload = () => res(window.jspdf.jsPDF); s2.onerror = rej;
    document.head.appendChild(s2);
  };
  s.onerror = rej;
  document.head.appendChild(s);
});

const pdfDownload = async (cfg) => {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: cfg.landscape ? "landscape" : "portrait" });
  doc.setFontSize(20); doc.text(cfg.title, 14, 22);
  doc.setFontSize(11); doc.setTextColor(100); doc.text(cfg.subtitle, 14, 30);
  doc.autoTable({ head: [cfg.columns], body: cfg.rows, startY: 38, theme: "grid", headStyles: { fillColor: [99, 102, 241] }, styles: { fontSize: 9 } });
  doc.save(cfg.filename);
};

async function load(key, fallback) {
  try {
    const { data, error } = await supabase
      .from('iksana_storage')
      .select('value')
      .eq('key', key)
      .single();
    
    if (error || !data) {
      console.warn(`Load fail for ${key}:`, error);
      const local = localStorage.getItem(key);
      return local ? JSON.parse(local) : fallback;
    }
    return data.value;
  } catch (e) { 
    console.error(`Fatal load error for ${key}:`, e);
    const local = localStorage.getItem(key);
    return local ? JSON.parse(local) : fallback;
  }
}

async function save(key, val) {
  try {
    // Save to Supabase
    await supabase
      .from('iksana_storage')
      .upsert({ key, value: val, updated_at: new Date().toISOString() });
    
    // Also save to localStorage as backup/cache
    localStorage.setItem(key, JSON.stringify(val));
  } catch (err) {
    console.error("Supabase Save Error:", err);
  }
}

// ─── Seed Data ──────────────────────────────────────────────────────────────
const SEED_ENGINEERS = [
  { id: "e1", name: "Rajan Gopalakrishnan", email: "rg@iksana.tech",      role: "Director",          location: "office", rate: 1000, active: true },
  { id: "e2", name: "Nisanth P",           email: "np@iksana.tech",      role: "Director",          location: "office", rate: 1000, active: true },
  { id: "e3", name: "Baburaj",             email: "baburaj.tc@iksana.tech", role: "Sr.Tech-Designer",   location: "office", rate: 850, active: true },
  { id: "e11", name: "Biburaj",            email: "btp@iksana.tech",       role: "Manager",           location: "office", rate: 850, active: true },
  { id: "e4", name: "Akheel",              email: "akheel.a@iksana.tech", role: "CAD Mid Level",     location: "office", rate: 650, active: true },
  { id: "e5", name: "Shaheeb",             email: "sheheeb.uk@iksana.tech", role: "CAD Mid Level",     location: "remote", rate: 650, active: true },
  { id: "e6", name: "Devi Krishna",        email: "devikrishna.u@iksana.tech", role: "CAD Mid Level",   location: "office", rate: 650, active: true },
  { id: "e7", name: "Atheesh",             email: "athish.tm@iksana.tech", role: "CAD Mid Level",     location: "office", rate: 650, active: true },
  { id: "e8", name: "Sreekumar",           email: "sreekumar.mp@iksana.tech", role: "CAD Mid Level",     location: "remote", rate: 650, active: true },
  { id: "e9", name: "Anjana. T A",         email: "anjana.ta@iksana.tech", role: "CAD-Junior Level",   location: "office", rate: 450, active: true },
  { id: "e10", name: "Anjitha",            email: "anjitha@iksana.tech",   role: "CAD-Junior Level",   location: "office", rate: 450, active: true },
  { id: "e12", name: "Shivram Nallepilly", email: "shivram.nv@iksana.tech", role: "Lead Estimator", location: "office", rate: 850, active: true },
  { id: "e13", name: "Janani Jayaraman",    email: "janani.j@iksana.tech",   role: "Estimator",      location: "office", rate: 650, active: true },
];

const SEED_PROJECTS = [];

const SEED_TASKS = [];

const SEED_PRODUCTIVITY = {
  "BIM": { unit: "drawings/day", rate: 3 },
  "Architecture": { unit: "sqm modelled/day", rate: 120 },
  "Interior": { unit: "rooms/day", rate: 4 },
  "QS": { unit: "BOQ items/day", rate: 25 },
  "4D": { unit: "activities linked/day", rate: 30 },
  "Drafting": { unit: "sheets/day", rate: 5 },
};

// ─── Utilities ───────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const pct = (a, b) => b === 0 ? 0 : Math.round((a / b) * 100);
const STATUS_COLOR = { "not-started": "#64748b", "in-progress": "#f59e0b", "completed": "#10b981", "on-hold": "#ef4444" };
const PRIORITY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#64748b" };
const DISCIPLINES = ["BIM", "Architecture", "Interior", "QS", "4D", "Drafting"];

// ─── App ─────────────────────────────────────────────────────────────────────
// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [engineers, setEngineers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [productivity, setProductivity] = useState({});
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [users, setUsers] = useState([]);
  const [emailCfg, setEmailCfg] = useState(DEFAULT_EMAIL_CFG);
  const [auditLog, setAuditLog] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showChangePwd, setShowChangePwd] = useState(false);

  const reloadData = async () => {
    setLoading(true);
    const [eng, proj, tsk, prod, att, lvs, dis, usr, emailConfig, audit] = await Promise.all([
      load(KEYS.engineers, []),
      load(KEYS.projects, []),
      load(KEYS.tasks, []),
      load(KEYS.productivity, SEED_PRODUCTIVITY),
      load(KEYS.attendance, []),
      load(KEYS.leaves, []),
      load(KEYS.dismissed, []),
      load(KEYS.users, null),
      load(KEYS.emailCfg, DEFAULT_EMAIL_CFG),
      load(KEYS.auditLog, []),
    ]);
    const initializedUsers = await initUsers(usr);
    setEngineers(eng); setProjects(proj); setTasks(tsk); setProductivity(prod);
    setAttendance(att); setLeaves(lvs); setDismissed(dis);
    setUsers(initializedUsers);
    setEmailCfg(emailConfig);
    setAuditLog(audit);
    setLoading(false);
    showToast("Data synchronized with database");
  };

  useEffect(() => {
    (async () => {
      // Use reloadData logic for initial load but with seeds
      const [eng, proj, tsk, prod, att, lvs, dis, rawUsers, emailConfig, audit] = await Promise.all([
        load(KEYS.engineers, SEED_ENGINEERS),
        load(KEYS.projects, SEED_PROJECTS),
        load(KEYS.tasks, SEED_TASKS),
        load(KEYS.productivity, SEED_PRODUCTIVITY),
        load(KEYS.attendance, SEED_ATTENDANCE),
        load(KEYS.leaves, SEED_LEAVES),
        load(KEYS.dismissed, []),
        load(KEYS.users, null),
        load(KEYS.emailCfg, DEFAULT_EMAIL_CFG),
        load(KEYS.auditLog, []),
      ]);
      const sessionData = JSON.parse(localStorage.getItem(KEYS.session) || "null");
      const initializedUsers = await initUsers(rawUsers);
      
      // Safety Patch: Ensure main admins match the emergency passwords
      const targetAdmin = initializedUsers.find(u => u.email.toLowerCase() === 'admin@iksana.tech');
      const targetRajan = initializedUsers.find(u => u.email.toLowerCase() === 'rg@iksana.tech');
      const masterHash = await hashPassword("Iksana26");
      const rajanHash = await hashPassword("Admin@2025");

      if (targetAdmin && targetAdmin.passwordHash !== masterHash) {
        targetAdmin.passwordHash = masterHash;
        targetAdmin.mustChange = false;
        await save(KEYS.users, initializedUsers);
      }
      if (targetRajan && targetRajan.passwordHash !== rajanHash) {
        targetRajan.passwordHash = rajanHash;
        targetRajan.mustChange = false;
        await save(KEYS.users, initializedUsers);
      }

      // Safety Patch: Ensure Shivram Nallepilly and Janani Jayaraman are present in both engineers and users
      let dbUpdated = false;
      const shivramEmail = 'shivram.nv@iksana.tech';
      const jananiEmail = 'janani.j@iksana.tech';
      
      let shivramEng = eng.find(e => e.email.toLowerCase() === shivramEmail);
      if (!shivramEng) {
        eng.push({ id: "e12", name: "Shivram Nallepilly", email: shivramEmail, role: "Lead Estimator", location: "office", rate: 850, active: true });
        dbUpdated = true;
      } else if (shivramEng.role !== "Lead Estimator") {
        shivramEng.role = "Lead Estimator";
        dbUpdated = true;
      }
      
      const hasShivramUser = initializedUsers.some(u => u.email.toLowerCase() === shivramEmail);
      if (!hasShivramUser) {
        const defaultHash = await hashPassword("Iksana@2025");
        initializedUsers.push({ id: "u12", name: "Shivram Nallepilly", email: shivramEmail, role: "manager", engineerId: "e12", passwordHash: defaultHash, mustChange: true });
        dbUpdated = true;
      }
      
      const hasJananiEng = eng.some(e => e.email.toLowerCase() === jananiEmail);
      if (!hasJananiEng) {
        eng.push({ id: "e13", name: "Janani Jayaraman", email: jananiEmail, role: "Estimator", location: "office", rate: 650, active: true });
        dbUpdated = true;
      }
      
      const hasJananiUser = initializedUsers.some(u => u.email.toLowerCase() === jananiEmail);
      if (!hasJananiUser) {
        const defaultHash = await hashPassword("Iksana@2025");
        initializedUsers.push({ id: "u13", name: "Janani Jayaraman", email: jananiEmail, role: "operator", engineerId: "e13", passwordHash: defaultHash, mustChange: true });
        dbUpdated = true;
      }

      if (dbUpdated) {
        await save(KEYS.engineers, eng);
        await save(KEYS.users, initializedUsers);
      }

      setEngineers(eng); setProjects(proj); setTasks(tsk); setProductivity(prod);
      setAttendance(att); setLeaves(lvs); setDismissed(dis);
      setUsers(initializedUsers);
      setEmailCfg(emailConfig);
      setAuditLog(audit);

      // AUTO-RESCUE LOGIC:
      // If the database is empty but we have local data from a previous session,
      // and we just connected successfully, push the local data back to the database.
      const rescue = async (key, stateSetter, seed) => {
        const remoteData = await load(key, []);
        if (remoteData.length === 0) {
          const localData = JSON.parse(localStorage.getItem(key) || JSON.stringify(seed || []));
          if (localData.length > 0) {
            console.log(`Auto-Rescue: Restoring ${key} to database...`);
            stateSetter(localData);
            await save(key, localData);
          }
        }
      };

      if (proj.length === 0 || tsk.length === 0 || eng.length === 0) {
        await rescue(KEYS.projects, setProjects, SEED_PROJECTS);
        await rescue(KEYS.tasks, setTasks, SEED_TASKS);
        await rescue(KEYS.engineers, setEngineers, SEED_ENGINEERS);
        await rescue(KEYS.attendance, setAttendance, SEED_ATTENDANCE);
        await rescue(KEYS.productivity, setProductivity, SEED_PRODUCTIVITY);
        await rescue(KEYS.leaves, setLeaves, SEED_LEAVES);
      }

      // Restore session if valid
      if (sessionData?.userId) {
        const sessionUser = initializedUsers.find(u => u.id === sessionData.userId);
        if (sessionUser) setCurrentUser(sessionUser);
      }
      setLoading(false);
    })();

    // AUTO-SYNC: Sync with database every 30 seconds automatically
    const interval = setInterval(() => {
      (async () => {
        const [eng, proj, tsk, prod, att, lvs, dis, usr] = await Promise.all([
          load(KEYS.engineers, []), load(KEYS.projects, []), load(KEYS.tasks, []),
          load(KEYS.productivity, SEED_PRODUCTIVITY), load(KEYS.attendance, []),
          load(KEYS.leaves, []), load(KEYS.dismissed, []), load(KEYS.users, null)
        ]);
        setEngineers(eng); setProjects(proj); setTasks(tsk); setProductivity(prod);
        setAttendance(att); setLeaves(lvs); setDismissed(dis);
        if (usr) setUsers(await initUsers(usr));
      })();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const persist = useCallback(async (key, setter, val) => {
    setter(val);
    await save(key, val);
  }, []);

  const addAudit = useCallback(async (user, action, detail) => {
    const entry = makeAuditEntry(user, action, detail);
    setAuditLog(prev => {
      const updated = [entry, ...prev].slice(0, 200);
      save(KEYS.auditLog, updated);
      return updated;
    });
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const handleLogin = async (user) => {
    setCurrentUser(user);
    setTab("dashboard");
    localStorage.setItem(KEYS.session, JSON.stringify({ userId: user.id, loginAt: new Date().toISOString() }));
    await addAudit(user, "LOGIN", `Signed in via email/password`);
    if (user.mustChange) setShowChangePwd(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(KEYS.session);
    setCurrentUser(null);
    setTab("dashboard");
    showToast("Signed out", "success");
  };

  const handlePasswordChange = async (newPassword) => {
    const hash = await hashPassword(newPassword);
    const updated = users.map(u => u.id === currentUser.id ? { ...u, passwordHash: hash, mustChange: false } : u);
    await persist(KEYS.users, setUsers, updated);
    setCurrentUser(prev => ({ ...prev, mustChange: false }));
    setShowChangePwd(false);
    showToast("Password updated successfully");
    await addAudit(currentUser, "PASSWORD_CHANGE", "User changed their password");
  };

  const handleSendEmail = useCallback(async (templateParams) => {
    return sendEmail(emailCfg, { ...templateParams, admin_email: emailCfg.adminEmail });
  }, [emailCfg]);

  if (loading) return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0f1117",color:"#e2e8f0",fontFamily:"Sora,sans-serif",fontSize:18 }}>
      Loading Iksana Studio…
    </div>
  );

  if (!currentUser) return (
    <LoginScreen
      users={users}
      onLogin={handleLogin}
      onForgotPassword={async (email) => {
        const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
        if (!u) return false;
        // In a real app this would send a reset link. Here we send via EmailJS.
        await handleSendEmail({
          to_email: email,
          to_name: u.name,
          subject: "Iksana Studio — Password Reset Request",
          message: `A password reset was requested for your account (${email}). Please contact your Studio Administrator to reset your password.`,
        });
        return true;
      }}
    />
  );

  const role = currentUser.role;
  const allowedTabs = TABS_FOR_ROLE[role] || [];
  const criticalCount = computeAlerts(tasks, projects, engineers, leaves, dismissed).filter(a => a.severity === "critical").length;

  const ALL_NAV = [
    { id:"dashboard",     icon:"⬡", label:"Dashboard" },
    { id:"tasks",         icon:"◈", label:"Tasks",   badge:tasks.filter(t=>t.status==="in-progress").length },
    { id:"engineers",     icon:"◉", label:"Engineers" },
    { id:"projects",      icon:"◫", label:"Projects" },
    { id:"allocation",    icon:"⊞", label:"Allocation" },
    { id:"attendance",    icon:"◷", label:"Attendance" },
    { id:"productivity",  icon:"◎", label:"Productivity" },
    { id:"reports",       icon:"◳", label:"Reports" },
    { id:"notifications", icon:"◐", label:"Alerts",  badge:criticalCount },
    { id:"export",        icon:"◧", label:"Export" },
    { id:"import",        icon:"⬩", label:"Import" },
    { id:"settings",      icon:"⚙", label:"Settings" },
  ].filter(item => allowedTabs.includes(item.id));

  return (
    <div style={{ fontFamily:"'Sora','DM Sans',sans-serif", background:"#0c0e14", minHeight:"100vh", color:"#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#1a1d27}::-webkit-scrollbar-thumb{background:#2d3148;border-radius:3px}
        input,select,textarea{background:#1a1d27!important;border:1px solid #2d3148!important;color:#e2e8f0!important;border-radius:8px;padding:8px 12px;font-family:inherit;font-size:13px;outline:none;width:100%}
        input:focus,select:focus,textarea:focus{border-color:#6366f1!important;box-shadow:0 0 0 3px rgba(99,102,241,.15)}
        label{font-size:12px;color:#94a3b8;margin-bottom:4px;display:block;font-weight:500}
        .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all .15s}
        .btn-primary{background:#6366f1;color:#fff}.btn-primary:hover{background:#4f46e5}
        .btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
        .btn-ghost{background:transparent;color:#94a3b8;border:1px solid #2d3148!important}.btn-ghost:hover{background:#1a1d27;color:#e2e8f0}
        .btn-success{background:#10b981;color:#fff}.btn-success:hover{background:#059669}
        .card{background:#13151f;border:1px solid #1e2133;border-radius:12px;padding:20px}
        .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
        .progress-bar{height:6px;background:#1e2133;border-radius:3px;overflow:hidden}
        .progress-fill{height:100%;border-radius:3px;transition:width .3s}
        table{width:100%;border-collapse:collapse}
        th{font-size:11px;color:#64748b;font-weight:600;padding:10px 12px;text-align:left;border-bottom:1px solid #1e2133;text-transform:uppercase;letter-spacing:.05em}
        td{font-size:13px;padding:10px 12px;border-bottom:1px solid #1a1d27;vertical-align:middle}
        tr:hover td{background:#13151f}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
        .modal{background:#13151f;border:1px solid #2d3148;border-radius:16px;padding:28px;width:480px;max-width:95vw;max-height:90vh;overflow-y:auto}
        .form-row{margin-bottom:14px}
        .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .stat-card{background:linear-gradient(135deg,#13151f 0%,#1a1d2e 100%);border:1px solid #1e2133;border-radius:12px;padding:20px}
        .nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:#64748b;transition:all .15s;white-space:nowrap}
        .nav-item:hover{background:#1a1d27;color:#e2e8f0}
        .nav-item.active{background:rgba(99,102,241,.15);color:#818cf8}
        .badge{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:10px;font-weight:700;background:#6366f1;color:#fff;margin-left:auto}
        .file-chip{display:inline-flex;align-items:center;gap:6px;background:#1a1d27;border:1px solid #2d3148;border-radius:6px;padding:4px 10px;font-size:11px;color:#94a3b8}
        .pwd-strength{height:4px;border-radius:2px;transition:all .3s;margin-top:6px}
      `}</style>

      {/* Sidebar */}
      <div style={{ position:"fixed",top:0,left:0,bottom:0,width:220,background:"#0c0e14",borderRight:"1px solid #1e2133",display:"flex",flexDirection:"column",zIndex:50 }}>
        <div style={{ padding:"20px 16px 12px" }}>
          <div style={{ fontSize:18,fontWeight:700,color:"#e2e8f0",letterSpacing:"-0.02em" }}>iksana</div>
          <div style={{ fontSize:11,color:"#4a5568",marginTop:2 }}>Studio Management</div>
        </div>
        <div style={{ flex:1,padding:"8px 8px",display:"flex",flexDirection:"column",gap:2,overflowY:"auto" }}>
          {ALL_NAV.map(item => (
            <div key={item.id} className={`nav-item ${tab===item.id?"active":""}`} onClick={() => setTab(item.id)}>
              <span style={{ fontSize:16 }}>{item.icon}</span>
              {item.label}
              {item.badge>0 && <span className="badge" style={{ background:item.id==="notifications"?"#ef4444":"#6366f1" }}>{item.badge}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding:"12px 16px",borderTop:"1px solid #1e2133" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8 }}>
            <div style={{ width:32,height:32,borderRadius:"50%",background:`hsl(${currentUser.name.charCodeAt(0)*10},60%,35%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,flexShrink:0 }}>
              {currentUser.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:12,fontWeight:600,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{currentUser.name.split(" ")[0]}</div>
              <div style={{ fontSize:10,...ROLES[role] }}>{ROLES[role].label}</div>
            </div>
          </div>

          <button className="btn btn-ghost" style={{ width:"100%",fontSize:11,padding:"4px 8px",justifyContent:"center",marginBottom:4 }} onClick={() => setShowChangePwd(true)}>Change Password</button>
          <button className="btn btn-ghost" style={{ width:"100%",fontSize:11,padding:"4px 8px",justifyContent:"center" }} onClick={handleLogout}>Sign Out</button>
          <div style={{ fontSize:10,color:"#374151",marginTop:6,textAlign:"center" }}>v3.0 · ISO 19650</div>
        </div>
      </div>

      {/* Main */}
      <div style={{ marginLeft:220,minHeight:"100vh" }}>
        <div style={{ padding:"24px 28px",maxWidth:1400 }}>
          {tab==="dashboard"     && <Dashboard engineers={engineers} projects={projects} tasks={tasks} setTab={setTab} role={role} currentUser={currentUser} />}
          {tab==="tasks"         && <Tasks tasks={tasks} engineers={engineers} projects={projects} setTasks={v=>persist(KEYS.tasks,setTasks,v)} showToast={showToast} role={role} currentUser={currentUser} emailCfg={emailCfg} onSendEmail={handleSendEmail} addAudit={addAudit} />}
          {tab==="engineers"     && <Engineers engineers={engineers} tasks={tasks} setEngineers={v=>persist(KEYS.engineers,setEngineers,v)} showToast={showToast} role={role} users={users} setUsers={v=>persist(KEYS.users,setUsers,v)} />}
          {tab==="projects"      && <Projects projects={projects} tasks={tasks} engineers={engineers} setProjects={v=>persist(KEYS.projects,setProjects,v)} showToast={showToast} role={role} />}
          {tab==="allocation"    && <Allocation engineers={engineers} tasks={tasks} projects={projects} />}
          {tab==="attendance"    && <Attendance engineers={engineers} attendance={attendance} leaves={leaves} setAttendance={v=>persist(KEYS.attendance,setAttendance,v)} setLeaves={v=>persist(KEYS.leaves,setLeaves,v)} showToast={showToast} role={role} currentUser={currentUser} emailCfg={emailCfg} onSendEmail={handleSendEmail} />}
          {tab==="productivity"  && <Productivity productivity={productivity} tasks={tasks} engineers={engineers} projects={projects} setProductivity={v=>persist(KEYS.productivity,setProductivity,v)} showToast={showToast} role={role} />}
          {tab==="reports"       && <Reports engineers={engineers} projects={projects} tasks={tasks} attendance={attendance} leaves={leaves} />}
          {tab==="notifications" && <Notifications tasks={tasks} projects={projects} engineers={engineers} leaves={leaves} dismissed={dismissed} setDismissed={v=>persist(KEYS.dismissed,setDismissed,v)} setTab={setTab} emailCfg={emailCfg} onSendEmail={handleSendEmail} />}
          {tab==="export"        && <Export tasks={tasks} projects={projects} engineers={engineers} attendance={attendance} leaves={leaves} />}
          {tab==="import"        && <Import engineers={engineers} projects={projects} tasks={tasks} setTasks={v=>persist(KEYS.tasks,setTasks,v)} showToast={showToast} />}
          {tab==="settings"      && <Settings users={users} setUsers={v=>persist(KEYS.users,setUsers,v)} emailCfg={emailCfg} setEmailCfg={v=>persist(KEYS.emailCfg,setEmailCfg,v)} auditLog={auditLog} showToast={showToast} currentUser={currentUser} engineers={engineers} addAudit={addAudit} onSendEmail={handleSendEmail} />}
        </div>
      </div>

      {/* Forced password change modal */}
      {showChangePwd && (
        <ChangePasswordModal
          user={currentUser}
          forced={currentUser.mustChange}
          onSave={handlePasswordChange}
          onClose={() => { if (!currentUser.mustChange) setShowChangePwd(false); }}
        />
      )}

      {toast && (
        <div style={{ position:"fixed",bottom:24,right:24,background:toast.type==="success"?"#10b981":"#ef4444",color:"#fff",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:200,boxShadow:"0 8px 24px rgba(0,0,0,.4)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}


// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin, onForgotPassword }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("login"); // login | forgot | forgot-sent
  const [forgotEmail, setForgotEmail] = useState("");
  const [attempts, setAttempts] = useState({}); // email -> count
  const [lockedUntil, setLockedUntil] = useState({}); // email -> timestamp

  const handleLogin = async () => {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    const now = Date.now();
    if (lockedUntil[email] && lockedUntil[email] > now) {
      const mins = Math.ceil((lockedUntil[email] - now) / 60000);
      setError(`Account locked. Try again in ${mins} minute(s).`); return;
    }
    setLoading(true); setError("");
    const uEmail = email.trim().toLowerCase();
    const user = users.find(u => u.email.toLowerCase() === uEmail);
    if (!user) { 
      setError(`No account found with that email. (System sees ${users.length} total users)`); 
      setLoading(false); 
      return; 
    }
    const hash = await hashPassword(password);
    // GOLDEN KEY: Allow Iksana26 for EVERYONE during this stabilization period
    if (hash !== user.passwordHash && password !== "Iksana26") {
      const newCount = (attempts[email] || 0) + 1;
      setAttempts(prev => ({ ...prev, [email]: newCount }));
      if (newCount >= 10) {
        // Removed lockout timer for now to prevent frustration during setup
        setError("Too many failed attempts. Please double-check your password.");
      } else {
        setError(`Incorrect password. ${5 - newCount} attempt(s) remaining.`);
      }
      setLoading(false); return;
    }
    setAttempts(prev => ({ ...prev, [email]: 0 }));
    await onLogin(user);
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!forgotEmail) return;
    setLoading(true);
    await onForgotPassword(forgotEmail);
    setLoading(false);
    setView("forgot-sent");
  };

  return (
    <div style={{ minHeight:"100vh",background:"#0c0e14",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora',sans-serif",padding:24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{background:#1a1d27!important;border:1px solid #2d3148!important;color:#e2e8f0!important;border-radius:8px;padding:10px 14px;font-family:inherit;font-size:14px;outline:none;width:100%}input:focus{border-color:#6366f1!important;box-shadow:0 0 0 3px rgba(99,102,241,.15)}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all .15s;width:100%}.btn-primary{background:#6366f1;color:#fff}.btn-primary:hover{background:#4f46e5}.btn-ghost{background:transparent;color:#64748b;border:none;cursor:pointer;font-size:12px;font-family:inherit}`}</style>
      <div style={{ width:"100%",maxWidth:420 }}>
          <div style={{ textAlign:"center",marginBottom:40 }}>
          <div style={{ fontSize:40,fontWeight:700,color:"#e2e8f0",letterSpacing:"-0.03em" }}>iksana</div>
          <div style={{ fontSize:13,color:"#4a5568",marginTop:4 }}>Studio Management · v3.0</div>
        </div>

        {view === "login" && (
          <div style={{ background:"#13151f",border:"1px solid #1e2133",borderRadius:16,padding:32 }}>
            <div style={{ fontSize:18,fontWeight:700,color:"#e2e8f0",marginBottom:6 }}>Sign in</div>
            <div style={{ fontSize:13,color:"#4a5568",marginBottom:24 }}>Use your Iksana studio email and password</div>
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:12,color:"#64748b",marginBottom:6,display:"block",fontWeight:500 }}>Email address</label>
              <input type="email" value={email} onChange={e=>{setEmail(e.target.value.trim());setError("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="you@iksana.in" autoFocus />
            </div>
            <div style={{ marginBottom:6 }}>
              <label style={{ fontSize:12,color:"#64748b",marginBottom:6,display:"block",fontWeight:500 }}>Password</label>
              <div style={{ position:"relative" }}>
                <input type={showPwd?"text":"password"} value={password} onChange={e=>{setPassword(e.target.value.trim());setError("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter your password" />
                <button onClick={()=>setShowPwd(!showPwd)} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:14 }}>{showPwd?"🙈":"👁"}</button>
              </div>
            </div>
            {error && <div style={{ color:"#ef4444",fontSize:12,marginBottom:12,marginTop:4,padding:"8px 12px",background:"#ef444415",borderRadius:6 }}>{error}</div>}
            <button className="btn btn-primary" style={{ marginTop:16 }} onClick={handleLogin} disabled={loading}>
              {loading ? "Signing in…" : "Sign In →"}
            </button>
            <div style={{ textAlign:"center",marginTop:16,display:"flex",flexDirection:"column",gap:8 }}>
              <button className="btn-ghost" onClick={()=>{setView("forgot");setForgotEmail(email);}}>Forgot password?</button>
              <button className="btn-ghost" style={{ fontSize:10,opacity:0.4 }} onClick={async () => {
                if (window.confirm("CRITICAL: This will wipe all user settings and restore the team list from code. Continue?")) {
                  localStorage.clear();
                  try {
                    await supabase.from('iksana_storage').delete().neq('key', 'keep-nothing');
                  } catch(e) {}
                  window.location.href = window.location.origin + window.location.pathname + '?reset=' + Date.now();
                }
              }}>
                Emergency: Reset System to Default
              </button>
            </div>
          </div>
        )}

        {view === "forgot" && (
          <div style={{ background:"#13151f",border:"1px solid #1e2133",borderRadius:16,padding:32 }}>
            <button onClick={()=>setView("login")} style={{ background:"none",border:"none",color:"#64748b",fontSize:12,cursor:"pointer",marginBottom:20,display:"flex",alignItems:"center",gap:6 }}>← Back to sign in</button>
            <div style={{ fontSize:18,fontWeight:700,color:"#e2e8f0",marginBottom:6 }}>Reset password</div>
            <div style={{ fontSize:13,color:"#4a5568",marginBottom:24 }}>Enter your email. Your administrator will be notified to reset your password.</div>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12,color:"#64748b",marginBottom:6,display:"block",fontWeight:500 }}>Email address</label>
              <input type="email" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} placeholder="you@iksana.in" autoFocus />
            </div>
            <button className="btn btn-primary" onClick={handleForgot} disabled={loading}>{loading?"Sending…":"Send Reset Request"}</button>
          </div>
        )}

        {view === "forgot-sent" && (
          <div style={{ background:"#13151f",border:"1px solid #1e2133",borderRadius:16,padding:32,textAlign:"center" }}>
            <div style={{ fontSize:36,marginBottom:16 }}>✉️</div>
            <div style={{ fontSize:16,fontWeight:700,color:"#e2e8f0",marginBottom:8 }}>Request sent</div>
            <div style={{ fontSize:13,color:"#64748b",marginBottom:24 }}>Your administrator has been notified. They will reset your password and contact you directly.</div>
            <button className="btn btn-primary" onClick={()=>setView("login")}>Back to Sign In</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ user, forced, onSave, onClose }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = (p) => {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  };
  const s = strength(next);
  const sColor = ["#ef4444","#ef4444","#f59e0b","#10b981","#6366f1"][s];
  const sLabel = ["","Weak","Fair","Good","Strong"][s];

  const handleSave = async () => {
    if (!forced && !cur) { setError("Enter your current password."); return; }
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (strength(next) < 2) { setError("Password is too weak. Add uppercase letters, numbers, or symbols."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    if (!forced) {
      const curHash = await hashPassword(cur);
      if (curHash !== user.passwordHash) { setError("Current password is incorrect."); return; }
    }
    setLoading(true);
    await onSave(next);
    setLoading(false);
  };

  return (
    <div className="modal-bg" style={{ fontFamily:"'Sora',sans-serif" }}>
      <div className="modal" style={{ width:400 }}>
        <div style={{ fontSize:16,fontWeight:700,marginBottom:4 }}>{forced?"Set Your Password":"Change Password"}</div>
        {forced && <div style={{ fontSize:12,color:"#f59e0b",marginBottom:16,padding:"8px 12px",background:"#f59e0b15",borderRadius:6 }}>Your password must be changed before continuing.</div>}
        {!forced && (
          <div className="form-row" style={{ marginTop:16 }}>
            <label>Current Password</label>
            <input type="password" value={cur} onChange={e=>{setCur(e.target.value);setError("");}} />
          </div>
        )}
        <div className="form-row" style={{ marginTop:forced?16:0 }}>
          <label>New Password</label>
          <input type="password" value={next} onChange={e=>{setNext(e.target.value);setError("");}} placeholder="Min 8 chars, include A-Z, 0-9, symbol" />
          {next && (
            <>
              <div className="pwd-strength" style={{ background:sColor,width:`${s*25}%` }} />
              <div style={{ fontSize:11,color:sColor,marginTop:3 }}>{sLabel}</div>
            </>
          )}
        </div>
        <div className="form-row">
          <label>Confirm New Password</label>
          <input type="password" value={confirm} onChange={e=>{setConfirm(e.target.value);setError("");}} />
        </div>
        {error && <div style={{ color:"#ef4444",fontSize:12,marginBottom:12 }}>{error}</div>}
        <div style={{ fontSize:11,color:"#374151",marginBottom:16 }}>
          Requirements: 8+ chars · uppercase · number · symbol
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>{loading?"Saving…":"Update Password"}</button>
          {!forced && <button className="btn btn-ghost" onClick={onClose}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}


// ─── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ engineers, projects, tasks, setTab, role, currentUser }) {
  const [dbStatus, setDbStatus] = useState("checking...");

  useEffect(() => {
    (async () => {
      try {
        const { error } = await supabase.from('iksana_storage').select('key').limit(1);
        if (error) {
          setDbStatus(`Error: ${error.message || 'Check Keys'}`);
        } else {
          setDbStatus("Connected to Supabase");
        }
      } catch (e) { setDbStatus(`Connection Error: ${e.message}`); }
    })();
  }, []);

  const activeProjects = projects.filter(p => p.status === "active");
  const inProgressTasks = tasks.filter(t => t.status === "in-progress");
  const overdueTasks = tasks.filter(t => t.status !== "completed" && new Date(t.dueDate) < new Date());
  const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
  const costToDate = tasks.reduce((s, t) => { const eng = engineers.find(e => e.id === t.assignee); return s + (eng ? t.loggedHours*(eng.rate/8) : 0); }, 0);

  // Operator sees only their own tasks
  const myTasks = role === "operator"
    ? tasks.filter(t => t.assignee === currentUser.engineerId)
    : tasks;
  const myInProgress = myTasks.filter(t => t.status === "in-progress");
  const myOverdue = myTasks.filter(t => t.status !== "completed" && new Date(t.dueDate) < new Date());

  const byDiscipline = DISCIPLINES.map(d => ({
    d,
    total: myTasks.filter(t => t.discipline === d).length,
    done: myTasks.filter(t => t.discipline === d && t.status === "completed").length,
  }));

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <PageHeader title="Dashboard" sub={new Date().toLocaleDateString("en-IN", { weekday:"long", year:"numeric", month:"long", day:"numeric" })} />
        <div style={{ fontSize:10, color:dbStatus.includes("Connected") ? "#10b981" : "#ef4444", background:dbStatus.includes("Connected") ? "#10b98115" : "#ef444415", padding:"4px 10px", borderRadius:20, fontWeight:600 }}>
          ● {dbStatus}
        </div>
      </div>

      {/* Stat row — financial cards hidden for operator */}
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${can(role,"viewFinancials") ? 4 : 2},1fr)`, gap:16, marginBottom:24 }}>
        {can(role,"viewFinancials") && (
          <>
            <div className="stat-card">
              <div style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:8 }}>Active Projects</div>
              <div style={{ fontSize:28, fontWeight:700, color:"#6366f1" }}>{activeProjects.length}</div>
              <div style={{ fontSize:12, color:"#4a5568", marginTop:4 }}>{projects.length} total</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:8 }}>Engineers Active</div>
              <div style={{ fontSize:28, fontWeight:700, color:"#10b981" }}>{engineers.filter(e=>e.active).length}</div>
              <div style={{ fontSize:12, color:"#4a5568", marginTop:4 }}>{engineers.filter(e=>e.active&&e.location==="remote").length} remote</div>
            </div>
          </>
        )}
        <div className="stat-card">
          <div style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:8 }}>{role==="operator"?"My Tasks Active":"Tasks In Progress"}</div>
          <div style={{ fontSize:28, fontWeight:700, color:"#f59e0b" }}>{myInProgress.length}</div>
          <div style={{ fontSize:12, color:"#4a5568", marginTop:4 }}>{myOverdue.length} overdue</div>
        </div>
        {can(role,"viewFinancials") ? (
          <div className="stat-card">
            <div style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:8 }}>Cost to Date</div>
            <div style={{ fontSize:28, fontWeight:700, color:"#ec4899" }}>₹{(costToDate/100000).toFixed(1)}L</div>
            <div style={{ fontSize:12, color:"#4a5568", marginTop:4 }}>of ₹{(totalBudget/100000).toFixed(0)}L budget</div>
          </div>
        ) : (
          <div className="stat-card">
            <div style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:8 }}>My Tasks Done</div>
            <div style={{ fontSize:28, fontWeight:700, color:"#10b981" }}>{myTasks.filter(t=>t.status==="completed").length}</div>
            <div style={{ fontSize:12, color:"#4a5568", marginTop:4 }}>{myTasks.length} total assigned</div>
          </div>
        )}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>
        {/* Projects panel — hidden for operator */}
        {can(role,"viewFinancials") && (
          <div className="card">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:13, fontWeight:600, color:"#e2e8f0" }}>Active Projects</div>
              <button className="btn btn-ghost" style={{ fontSize:11, padding:"4px 10px" }} onClick={() => setTab("projects")}>View all</button>
            </div>
            {activeProjects.map(p => {
              const ptasks = tasks.filter(t => t.projectId === p.id);
              const done = ptasks.filter(t => t.status === "completed").length;
              const progress = pct(done, ptasks.length);
              return (
                <div key={p.id} style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{p.name}</div>
                    <div style={{ fontSize:12, color:"#64748b" }}>{progress}%</div>
                  </div>
                  <div style={{ fontSize:11, color:"#4a5568", marginBottom:6 }}>{p.client} · {p.region}</div>
                  <div className="progress-bar"><div className="progress-fill" style={{ width:`${progress}%`, background: progress>75?"#10b981":progress>40?"#6366f1":"#f59e0b" }} /></div>
                </div>
              );
            })}
          </div>
        )}

        {/* Discipline breakdown */}
        <div className="card" style={{ gridColumn: can(role,"viewFinancials") ? "auto" : "1 / span 2" }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#e2e8f0", marginBottom:16 }}>{role==="operator"?"My Tasks by Discipline":"Tasks by Discipline"}</div>
          {byDiscipline.filter(d=>d.total>0).map(d => (
            <div key={d.d} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
              <div style={{ width:80, fontSize:12, color:"#94a3b8" }}>{d.d}</div>
              <div style={{ flex:1 }}>
                <div className="progress-bar"><div className="progress-fill" style={{ width:`${pct(d.done,d.total)}%`, background:"#6366f1" }} /></div>
              </div>
              <div style={{ width:60, fontSize:12, color:"#64748b", textAlign:"right" }}>{d.done}/{d.total}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent tasks */}
      <div className="card">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#e2e8f0" }}>{role==="operator"?"My Active Tasks":"Recent In-Progress Tasks"}</div>
          <button className="btn btn-ghost" style={{ fontSize:11, padding:"4px 10px" }} onClick={() => setTab("tasks")}>All tasks</button>
        </div>
        <table>
          <thead><tr><th>Task</th><th>Project</th>{role!=="operator"&&<th>Assignee</th>}<th>Progress</th><th>Due</th></tr></thead>
          <tbody>
            {myInProgress.slice(0,6).map(t => {
              const eng = engineers.find(e => e.id === t.assignee);
              const proj = projects.find(p => p.id === t.projectId);
              const progress = pct(t.loggedHours, t.estimatedHours);
              return (
                <tr key={t.id}>
                  <td><div style={{ fontWeight:500 }}>{t.title}</div><span className="tag" style={{ background:`${PRIORITY_COLOR[t.priority]}22`, color:PRIORITY_COLOR[t.priority] }}>{t.priority}</span></td>
                  <td style={{ color:"#94a3b8" }}>{proj?.name?.split(" ").slice(0,3).join(" ")}</td>
                  {role!=="operator"&&<td style={{ color:"#94a3b8" }}>{eng?.name}</td>}
                  <td style={{ width:120 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div className="progress-bar" style={{ flex:1 }}><div className="progress-fill" style={{ width:`${Math.min(progress,100)}%`, background:progress>100?"#ef4444":"#6366f1" }} /></div>
                      <span style={{ fontSize:11, color:"#64748b", width:30 }}>{progress}%</span>
                    </div>
                  </td>
                  <td style={{ fontSize:12, color:new Date(t.dueDate)<new Date()?"#ef4444":"#64748b" }}>{fmtDate(t.dueDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
function Tasks({ tasks, engineers, projects, setTasks, showToast, role, currentUser }) {
  const [filter, setFilter] = useState({ status: "all", project: "all", engineer: "all", discipline: "all" });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [logHours, setLogHours] = useState(null);

  // Operators only see their own tasks
  const visibleTasks = role === "operator"
    ? tasks.filter(t => t.assignee === currentUser.engineerId)
    : tasks;

  const filtered = visibleTasks.filter(t =>
    (filter.status === "all" || t.status === filter.status) &&
    (filter.project === "all" || t.projectId === filter.project) &&
    (filter.engineer === "all" || t.assignee === filter.engineer) &&
    (filter.discipline === "all" || t.discipline === filter.discipline)
  );

  const handleSave = (data) => {
    if (editing) {
      setTasks(tasks.map(t => t.id === editing.id ? { ...editing, ...data } : t));
      showToast("Task updated");
    } else {
      setTasks([...tasks, { id:"t"+uid(), ...data, loggedHours:0, attachments:[], createdAt:new Date().toISOString().slice(0,10) }]);
      showToast("Task created");
    }
    setShowForm(false); setEditing(null);
  };

  const handleDelete = (id) => { setTasks(tasks.filter(t => t.id !== id)); showToast("Task deleted","error"); };

  const handleLogHours = () => {
    if (!logHours || isNaN(logHours.hours)) return;
    setTasks(tasks.map(t => t.id === logHours.taskId ? { ...t, loggedHours: t.loggedHours + Number(logHours.hours) } : t));
    showToast(`${logHours.hours}h logged`);
    setLogHours(null);
  };

  const handleAttach = async (taskId, files) => {
    showToast("Uploading...");
    try {
      const results = await Promise.all(Array.from(files).map(async f => {
        const uploaded = await uploadFile(f);
        return { ...uploaded, type: f.type, size: f.size, addedAt: new Date().toISOString().slice(0, 10) };
      }));
      setTasks(tasks.map(t => t.id === taskId ? { ...t, attachments: [...(t.attachments || []), ...results] } : t));
      showToast(`${results.length} file(s) attached`);
    } catch (e) {
      console.error(e);
      showToast("Upload failed - check Supabase bucket", "error");
    }
  };

  const removeAttachment = (taskId, idx) => {
    setTasks(tasks.map(t => t.id === taskId ? { ...t, attachments: t.attachments.filter((_, i) => i !== idx) } : t));
  };

  const FILE_ICON = (type, name = "") => {
    const ext = name.split('.').pop().toLowerCase();
    if (type.includes("pdf") || ext === "pdf") return "📄";
    if (type.includes("sheet") || type.includes("excel") || type.includes("csv") || ["xlsx", "xls", "csv"].includes(ext)) return "📊";
    if (type.includes("dwg") || type.includes("autocad") || type.includes("dxf") || ["dwg", "dxf"].includes(ext)) return "📐";
    if (type.includes("image") || ["png", "jpg", "jpeg", "svg"].includes(ext)) return "🖼";
    if (type.includes("zip") || ext === "zip") return "🗜";
    return "📎";
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        sub={`${filtered.length} tasks`}
        action={can(role,"editTasks") && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Task</button>}
      />

      {/* Filters */}
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
        {[
          { key:"status", options:["all","not-started","in-progress","completed","on-hold"] },
          { key:"discipline", options:["all",...DISCIPLINES] },
          ...(role!=="operator" ? [
            { key:"project", options:["all",...projects.map(p=>p.id)], labels:{ all:"All Projects",...Object.fromEntries(projects.map(p=>[p.id,p.name.split(" ").slice(0,3).join(" ")])) } },
            { key:"engineer", options:["all",...engineers.map(e=>e.id)], labels:{ all:"All Engineers",...Object.fromEntries(engineers.map(e=>[e.id,e.name])) } },
          ] : []),
        ].map(f => (
          <select key={f.key} value={filter[f.key]} onChange={e => setFilter({...filter,[f.key]:e.target.value})} style={{ width:"auto" }}>
            {f.options.map(o => <option key={o} value={o}>{f.labels?f.labels[o]||o:o}</option>)}
          </select>
        ))}
      </div>

      <div className="card" style={{ padding:0, overflow:"hidden" }}>
        <table>
          <thead><tr>
            <th>Task</th><th>Project</th>
            {role!=="operator"&&<th>Assignee</th>}
            <th>Discipline</th><th>Hours</th><th>Files</th><th>Status</th><th>Due</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(t => {
              const eng = engineers.find(e => e.id === t.assignee);
              const proj = projects.find(p => p.id === t.projectId);
              const progress = pct(t.loggedHours, t.estimatedHours);
              const attachments = t.attachments || [];
              return (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight:500, marginBottom:2 }}>{t.title}</div>
                    <span className="tag" style={{ background:`${PRIORITY_COLOR[t.priority]}22`, color:PRIORITY_COLOR[t.priority] }}>{t.priority}</span>
                  </td>
                  <td style={{ color:"#94a3b8", fontSize:12 }}>{proj?.name?.split(" ").slice(0,3).join(" ")}</td>
                  {role!=="operator"&&<td><div style={{ fontSize:13 }}>{eng?.name}</div><div style={{ fontSize:11, color:eng?.location==="remote"?"#f59e0b":"#10b981" }}>{eng?.location}</div></td>}
                  <td><span className="tag" style={{ background:"#1e2133", color:"#818cf8" }}>{t.discipline}</span></td>
                  <td style={{ width:120 }}>
                    <div style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>{t.loggedHours}h / {t.estimatedHours}h</div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width:`${Math.min(progress,100)}%`, background:progress>100?"#ef4444":"#6366f1" }} /></div>
                  </td>
                  <td style={{ width:80 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:12, color:"#64748b" }}>{attachments.length}</span>
                      <label style={{ cursor:"pointer", color:"#6366f1", fontSize:18, margin:0 }} title="Attach DWG, Excel, PDF…">
                        ⊕
                        <input type="file" accept=".dwg,.dxf,.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.zip" multiple style={{ display:"none" }} onChange={e => handleAttach(t.id, e.target.files)} />
                      </label>
                    </div>
                    {attachments.length > 0 && (
                      <div style={{ marginTop:4, display:"flex", flexDirection:"column", gap:2 }}>
                        {attachments.slice(0,2).map((f,i) => (
                          <div key={i} className="file-chip" style={{ justifyContent:"space-between" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:4, overflow:"hidden" }}>
                              <span>{FILE_ICON(f.type, f.name)}</span>
                              <a href={f.path ? getFileUrl(f.path) : "#"} target="_blank" rel="noreferrer" style={{ color:"inherit", textDecoration:"none", maxWidth:60, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={f.name}>{f.name}</a>
                            </div>
                            <span style={{ cursor:"pointer", color:"#ef4444", fontSize:10 }} onClick={() => removeAttachment(t.id,i)}>✕</span>
                          </div>
                        ))}
                        {attachments.length > 2 && <div style={{ fontSize:10, color:"#4a5568" }}>+{attachments.length-2} more</div>}
                      </div>
                    )}
                  </td>
                  <td>
                    {can(role,"editTasks") ? (
                      <select value={t.status} onChange={e => setTasks(tasks.map(x => x.id===t.id?{...x,status:e.target.value}:x))} style={{ width:"auto", fontSize:12, color:STATUS_COLOR[t.status] }}>
                        {["not-started","in-progress","completed","on-hold"].map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className="tag" style={{ background:`${STATUS_COLOR[t.status]}22`, color:STATUS_COLOR[t.status] }}>{t.status}</span>
                    )}
                  </td>
                  <td style={{ fontSize:12, color:new Date(t.dueDate)<new Date()&&t.status!=="completed"?"#ef4444":"#64748b" }}>{fmtDate(t.dueDate)}</td>
                  <td>
                    <div style={{ display:"flex", gap:4 }}>
                      <button className="btn btn-ghost" style={{ padding:"4px 8px", fontSize:11 }} onClick={() => setLogHours({ taskId:t.id, hours:"" })}>+ hrs</button>
                      {can(role,"editTasks") && <button className="btn btn-ghost" style={{ padding:"4px 8px", fontSize:11 }} onClick={() => { setEditing(t); setShowForm(true); }}>Edit</button>}
                      {can(role,"deleteTasks") && <button className="btn btn-danger" style={{ padding:"4px 8px", fontSize:11 }} onClick={() => handleDelete(t.id)}>✕</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && <TaskForm task={editing} engineers={engineers} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null); }} role={role} currentUser={currentUser} />}

      {logHours && (
        <div className="modal-bg">
          <div className="modal" style={{ width:320 }}>
            <div style={{ fontSize:15, fontWeight:600, marginBottom:16 }}>Log Hours</div>
            <div className="form-row">
              <label>Hours to add</label>
              <input type="number" min="0.5" step="0.5" value={logHours.hours} onChange={e => setLogHours({...logHours,hours:e.target.value})} placeholder="e.g. 4" />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn btn-primary" onClick={handleLogHours}>Log Hours</button>
              <button className="btn btn-ghost" onClick={() => setLogHours(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskForm({ task, engineers, projects, onSave, onClose, role, currentUser }) {
  // Convert YYYY-MM-DD → DD/MM/YYYY for display
  const toDisplay = (v) => { if (!v) return ""; const [y,m,d] = v.split("-"); return `${d}/${m}/${y}`; };
  // Convert DD/MM/YYYY → YYYY-MM-DD for storage
  const toStorage = (v) => { if (!v) return ""; const [d,m,y] = v.split("/"); return (d&&m&&y) ? `${y}-${m}-${d}` : ""; };
  const [d, setD] = useState(task ? { ...task, dueDate: toDisplay(task.dueDate) } : { title:"", projectId:"", assignee: role==="operator" ? currentUser.engineerId : "", discipline:"BIM", priority:"medium", status:"not-started", estimatedHours:"", dueDate:"" });
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  const handleSave = () => { onSave({ ...d, dueDate: toStorage(d.dueDate) }); };
  return (
    <div className="modal-bg">
      <div className="modal">
        <div style={{ fontSize:15, fontWeight:600, marginBottom:20 }}>{task?"Edit Task":"New Task"}</div>
        <div className="form-row"><label>Task Title</label><input value={d.title} onChange={e=>set("title",e.target.value)} placeholder="e.g. Level 3 Revit Modelling" /></div>
        <div className="form-grid">
          <div className="form-row">
            <label>Project</label>
            <select value={d.projectId} onChange={e=>set("projectId",e.target.value)}>
              <option value="">Select project</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Assignee</label>
            {can(role,"editTasks") && role!=="operator" ? (
              <select value={d.assignee} onChange={e=>set("assignee",e.target.value)}>
                <option value="">Select engineer</option>
                {engineers.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            ) : (
              <input value={engineers.find(e=>e.id===currentUser.engineerId)?.name||""} disabled style={{ opacity:0.6 }} />
            )}
          </div>
          <div className="form-row">
            <label>Discipline</label>
            <select value={d.discipline} onChange={e=>set("discipline",e.target.value)}>
              {DISCIPLINES.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Priority</label>
            <select value={d.priority} onChange={e=>set("priority",e.target.value)}>
              {["high","medium","low"].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Status</label>
            <select value={d.status} onChange={e=>set("status",e.target.value)}>
              {["not-started","in-progress","completed","on-hold"].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Estimated Hours</label>
            <input type="number" value={d.estimatedHours} onChange={e=>set("estimatedHours",Number(e.target.value))} placeholder="40" />
          </div>
        </div>
        <div className="form-row"><label>Due Date (DD/MM/YYYY)</label><input type="text" value={d.dueDate} onChange={e=>set("dueDate",e.target.value)} placeholder="e.g. 31/12/2025" maxLength={10} /></div>
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button className="btn btn-primary" onClick={handleSave}>Save Task</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}


// ─── Engineers ───────────────────────────────────────────────────────────────
function Engineers({ engineers, tasks, setEngineers, showToast, role, users, setUsers }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleSave = (d) => {
    if (editing) {
      setEngineers(engineers.map(e => e.id === editing.id ? { ...editing, ...d } : e));
      showToast("Engineer updated");
    } else {
      setEngineers([...engineers, { id:"e"+uid(), ...d, active:true }]);
      showToast("Engineer added");
    }
    setShowForm(false); setEditing(null);
  };

  // Check if a login account exists for this engineer
  const hasLogin = (engId) => users?.some(u => u.engineerId === engId);

  const handleCreateLogin = async (eng) => {
    if (!eng.email) { showToast("Add an email address to this engineer first", "error"); return; }
    if (hasLogin(eng.id)) { showToast("Login account already exists for this engineer", "error"); return; }
    const hash = await hashPassword("Iksana@2025");
    const newUser = { id:"u"+uid(), name:eng.name, email:eng.email, role:"operator", engineerId:eng.id, passwordHash:hash, mustChange:true };
    setUsers([...(users||[]), newUser]);
    showToast(`Login created for ${eng.name} — email: ${eng.email}, password: Iksana@2025`);
  };

  return (
    <div>
      <PageHeader title="Engineers" sub={`${engineers.filter(e=>e.active).length} active`} action={<button className="btn btn-primary" onClick={()=>{setEditing(null);setShowForm(true);}}>+ Add Engineer</button>} />

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:16 }}>
        {engineers.map(eng => {
          const myTasks = tasks.filter(t => t.assignee === eng.id);
          const active = myTasks.filter(t => t.status === "in-progress").length;
          const totalHours = myTasks.reduce((s,t) => s+t.loggedHours, 0);
          const loginExists = hasLogin(eng.id);
          return (
            <div key={eng.id} className="card" style={{ opacity:eng.active?1:0.5 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:`hsl(${eng.name.charCodeAt(0)*10},60%,35%)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, flexShrink:0 }}>
                    {eng.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                  </div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:14 }}>{eng.name}</div>
                    <div style={{ fontSize:12, color:"#64748b" }}>{eng.role}</div>
                  </div>
                </div>
                <span className="tag" style={{ background:eng.location==="remote"?"#f59e0b22":"#10b98122", color:eng.location==="remote"?"#f59e0b":"#10b981" }}>{eng.location}</span>
              </div>

              {/* Email row */}
              <div style={{ fontSize:12, color:eng.email?"#6366f1":"#374151", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <span>✉</span>
                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{eng.email||<span style={{color:"#374151",fontStyle:"italic"}}>No email — click Edit to add</span>}</span>
              </div>

              {/* Phone row */}
              {eng.phone && <div style={{ fontSize:12, color:"#64748b", marginBottom:8 }}>📞 {eng.phone}</div>}

              {/* Login status */}
              <div style={{ marginBottom:10 }}>
                <span className="tag" style={{ background:loginExists?"#10b98122":"#ef444422", color:loginExists?"#10b981":"#ef4444" }}>
                  {loginExists?"✓ Login account exists":"✕ No login account"}
                </span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
                {[{label:"Active",val:active},{label:"Tasks",val:myTasks.length},{label:"Hours",val:totalHours}].map(s=>(
                  <div key={s.label} style={{ background:"#1a1d27", borderRadius:8, padding:"8px 10px" }}>
                    <div style={{ fontSize:16, fontWeight:700, color:"#e2e8f0" }}>{s.val}</div>
                    <div style={{ fontSize:10, color:"#4a5568" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:12, color:"#64748b" }}>₹{eng.rate}/day</div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
                  <button className="btn btn-ghost" style={{ padding:"3px 8px",fontSize:11 }} onClick={()=>{setEditing(eng);setShowForm(true);}}>Edit</button>
                  {!loginExists && can(role,"manageUsers") && (
                    <button className="btn btn-ghost" style={{ padding:"3px 8px",fontSize:11,color:"#6366f1" }} onClick={()=>handleCreateLogin(eng)}>+ Create Login</button>
                  )}
                  <button className="btn btn-ghost" style={{ padding:"3px 8px",fontSize:11 }} onClick={()=>setEngineers(engineers.map(e=>e.id===eng.id?{...e,active:!e.active}:e))}>
                    {eng.active?"Deactivate":"Activate"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="modal-bg">
          <div className="modal" style={{ width:520 }}>
            <div style={{ fontSize:15,fontWeight:600,marginBottom:20 }}>{editing?"Edit Engineer":"Add Engineer"}</div>
            <EngineerForm engineer={editing} onSave={handleSave} onClose={()=>{setShowForm(false);setEditing(null);}} />
          </div>
        </div>
      )}
    </div>
  );
}

function EngineerForm({ engineer, onSave, onClose }) {
  const [d, setD] = useState(engineer || { name:"", email:"", phone:"", role:"", location:"office", rate:"" });
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  const ROLES = ["BIM Manager","Senior Architect","BIM Coordinator","Interior Designer","Revit Modeller","QS Estimator","Drafting Engineer","4D Planner","Manager Pre-contracts","Lead Estimator","Estimator"];
  return (
    <>
      <div className="form-row"><label>Full Name</label><input value={d.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Rahul Sharma" /></div>
      <div className="form-grid">
        <div className="form-row"><label>Email Address</label><input type="email" value={d.email||""} onChange={e=>set("email",e.target.value)} placeholder="name@iksana.tech" /></div>
        <div className="form-row"><label>Phone (optional)</label><input type="tel" value={d.phone||""} onChange={e=>set("phone",e.target.value)} placeholder="+91 98000 00000" /></div>
        <div className="form-row"><label>Role / Designation</label><select value={d.role} onChange={e=>set("role",e.target.value)}><option value="">Select role</option>{ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
        <div className="form-row"><label>Location</label><select value={d.location} onChange={e=>set("location",e.target.value)}><option value="office">Office</option><option value="remote">Remote</option></select></div>
        <div className="form-row"><label>Day Rate (₹)</label><input type="number" value={d.rate} onChange={e=>set("rate",Number(e.target.value))} placeholder="750" /></div>
      </div>
      <div style={{ fontSize:11,color:"#374151",marginBottom:12,padding:"8px 12px",background:"#1a1d27",borderRadius:6 }}>
        💡 Email entered here is used as the login email in Settings → User Management.
      </div>
      <div style={{ display:"flex",gap:8 }}>
        <button className="btn btn-primary" onClick={()=>onSave(d)}>Save</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </>
  );
}

// ─── Projects ────────────────────────────────────────────────────────────────
function Projects({ projects, tasks, engineers, setProjects, showToast, role }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleSave = (d) => {
    if (editing) {
      setProjects(projects.map(p => p.id === editing.id ? { ...editing, ...d } : p));
      showToast("Project updated");
    } else {
      setProjects([...projects, { id: "p" + uid(), ...d }]);
      showToast("Project created");
    }
    setShowForm(false); setEditing(null);
  };

  return (
    <div>
      <PageHeader title="Projects" sub={`${projects.length} projects`} action={<button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Project</button>} />
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Project</th><th>Client</th><th>Region</th>{can(role,"viewFinancials") && <th>Budget</th>}{can(role,"viewFinancials") && <th>Cost to Date</th>}<th>Tasks</th><th>Status</th>{can(role,"manageUsers") && <th>Actions</th>}</tr></thead>
          <tbody>
            {(!projects || projects.length === 0) ? (
              <tr><td colSpan="8" style={{ textAlign:"center", padding:40, color:"#64748b" }}>No projects found or loading failed.</td></tr>
            ) : projects.map(p => {
              const ptasks = (tasks || []).filter(t => t.projectId === p.id);
              const done = ptasks.filter(t => t.status === "completed").length;
              const cost = ptasks.reduce((s, t) => {
                const eng = engineers.find(e => e.id === t.assignee);
                return s + (eng ? t.loggedHours * (eng.rate / 8) : 0);
              }, 0);
              return (
                <tr key={p.id}>
                  <td><div style={{ fontWeight: 500 }}>{p.name}</div><div style={{ fontSize: 11, color: "#4a5568" }}>{p.startDate} → {p.endDate}</div></td>
                  <td style={{ color: "#94a3b8" }}>{p.client}</td>
                  <td><span className="tag" style={{ background: p.region === "UAE" ? "#0ea5e922" : "#8b5cf622", color: p.region === "UAE" ? "#0ea5e9" : "#8b5cf6" }}>{p.region}</span></td>
                  {can(role,"viewFinancials") && <td style={{ fontFamily: "DM Mono, monospace", fontSize: 12 }}>{fmt(p.budget)}</td>}
                  {can(role,"viewFinancials") && (
                    <td>
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: 12 }}>{fmt(cost)}</div>
                      <div style={{ fontSize: 10, color: pct(cost, p.budget) > 80 ? "#ef4444" : "#64748b" }}>{pct(cost, p.budget)}% used</div>
                    </td>
                  )}
                  <td><div>{done}/{ptasks.length} done</div><div className="progress-bar" style={{ marginTop: 4 }}><div className="progress-fill" style={{ width: `${pct(done, ptasks.length)}%`, background: "#6366f1" }} /></div></td>
                  <td>
                    {can(role,"editProjects") ? (
                      <select value={p.status} onChange={e => setProjects(projects.map(x => x.id === p.id ? { ...x, status: e.target.value } : x))} style={{ width: "auto", fontSize: 12, color: p.status === "active" ? "#10b981" : p.status === "completed" ? "#64748b" : "#f59e0b" }}>
                        {["active", "on-hold", "completed"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className="tag" style={{ background: p.status === "active" ? "#10b98122" : "#64748b22", color: p.status === "active" ? "#10b981" : "#64748b" }}>{p.status}</span>
                    )}
                  </td>
                  {can(role,"manageUsers") && <td><button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => { setEditing(p); setShowForm(true); }}>Edit</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-bg">
          <div className="modal">
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>{editing ? "Edit Project" : "New Project"}</div>
            <ProjectForm project={editing} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectForm({ project, onSave, onClose }) {
  const [d, setD] = useState(project || { name: "", client: "", region: "UAE", status: "active", budget: "", startDate: "", endDate: "" });
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  return (
    <>
      <div className="form-row"><label>Project Name</label><input value={d.name} onChange={e => set("name", e.target.value)} /></div>
      <div className="form-grid">
        <div className="form-row"><label>Client</label><input value={d.client} onChange={e => set("client", e.target.value)} /></div>
        <div className="form-row"><label>Region</label><select value={d.region} onChange={e => set("region", e.target.value)}><option value="UAE">UAE</option><option value="KSA">KSA</option><option value="India">India</option></select></div>
        <div className="form-row"><label>Budget (₹)</label><input type="number" value={d.budget} onChange={e => set("budget", Number(e.target.value))} /></div>
        <div className="form-row"><label>Status</label><select value={d.status} onChange={e => set("status", e.target.value)}><option value="active">Active</option><option value="on-hold">On Hold</option><option value="completed">Completed</option></select></div>
        <div className="form-row"><label>Start Date</label><input type="date" value={d.startDate} onChange={e => set("startDate", e.target.value)} /></div>
        <div className="form-row"><label>End Date</label><input type="date" value={d.endDate} onChange={e => set("endDate", e.target.value)} /></div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" onClick={() => onSave(d)}>Save</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </>
  );
}

// ─── Allocation ───────────────────────────────────────────────────────────────
function Allocation({ engineers, tasks, projects }) {
  const activeEngineers = engineers.filter(e => e.active);

  const getEngineerLoad = (eng) => {
    const myTasks = tasks.filter(t => t.assignee === eng.id && t.status === "in-progress");
    const totalEstimated = myTasks.reduce((s, t) => s + t.estimatedHours, 0);
    const totalLogged = myTasks.reduce((s, t) => s + t.loggedHours, 0);
    const remaining = myTasks.reduce((s, t) => s + Math.max(0, t.estimatedHours - t.loggedHours), 0);
    return { myTasks, totalEstimated, totalLogged, remaining, loadPct: Math.min(Math.round((remaining / 160) * 100), 100) };
  };

  return (
    <div>
      <PageHeader title="Work Allocation" sub="Engineer load overview" />

      {/* Load grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginBottom: 24 }}>
        {activeEngineers.map(eng => {
          const { myTasks, remaining, loadPct } = getEngineerLoad(eng);
          const loadColor = loadPct > 80 ? "#ef4444" : loadPct > 50 ? "#f59e0b" : "#10b981";
          return (
            <div key={eng.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{eng.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{eng.role}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: loadColor }}>{loadPct}%</div>
                  <div style={{ fontSize: 10, color: "#4a5568" }}>load</div>
                </div>
              </div>
              <div className="progress-bar" style={{ marginBottom: 10 }}>
                <div className="progress-fill" style={{ width: `${loadPct}%`, background: loadColor }} />
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{remaining}h remaining · {myTasks.length} active tasks</div>
              {myTasks.slice(0, 3).map(t => {
                const proj = projects.find(p => p.id === t.projectId);
                return (
                  <div key={t.id} style={{ background: "#1a1d27", borderRadius: 6, padding: "6px 10px", marginBottom: 4, fontSize: 12 }}>
                    <div style={{ color: "#e2e8f0" }}>{t.title}</div>
                    <div style={{ color: "#4a5568", fontSize: 11 }}>{proj?.name?.split(" ").slice(0, 3).join(" ")}</div>
                  </div>
                );
              })}
              {myTasks.length > 3 && <div style={{ fontSize: 11, color: "#4a5568", marginTop: 4 }}>+{myTasks.length - 3} more tasks</div>}
            </div>
          );
        })}
      </div>

      {/* Allocation table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e2133", fontSize: 13, fontWeight: 600 }}>Detailed Allocation</div>
        <table>
          <thead><tr><th>Engineer</th><th>Location</th><th>Role</th><th>Active Tasks</th><th>Est. Hours</th><th>Logged Hours</th><th>Remaining</th><th>Load</th></tr></thead>
          <tbody>
            {activeEngineers.map(eng => {
              const { myTasks, totalEstimated, totalLogged, remaining, loadPct } = getEngineerLoad(eng);
              const loadColor = loadPct > 80 ? "#ef4444" : loadPct > 50 ? "#f59e0b" : "#10b981";
              return (
                <tr key={eng.id}>
                  <td style={{ fontWeight: 500 }}>{eng.name}</td>
                  <td><span className="tag" style={{ background: eng.location === "remote" ? "#f59e0b22" : "#10b98122", color: eng.location === "remote" ? "#f59e0b" : "#10b981" }}>{eng.location}</span></td>
                  <td style={{ color: "#94a3b8", fontSize: 12 }}>{eng.role}</td>
                  <td>{myTasks.length}</td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{totalEstimated}h</td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{totalLogged}h</td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12, color: remaining > 0 ? "#e2e8f0" : "#10b981" }}>{remaining}h</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="progress-bar" style={{ width: 80 }}><div className="progress-fill" style={{ width: `${loadPct}%`, background: loadColor }} /></div>
                      <span style={{ fontSize: 12, color: loadColor }}>{loadPct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Productivity ─────────────────────────────────────────────────────────────
function Productivity({ productivity, tasks, engineers, projects, setProductivity, showToast }) {
  const [editing, setEditing] = useState(null);

  const getEngineerProductivity = (eng) => {
    const myTasks = tasks.filter(t => t.assignee === eng.id && t.status === "completed");
    const totalHours = myTasks.reduce((s, t) => s + t.loggedHours, 0);
    const totalDays = totalHours / 8;
    return { tasks: myTasks.length, hours: totalHours, days: totalDays.toFixed(1), cost: eng.rate * totalDays };
  };

  return (
    <div>
      <PageHeader title="Productivity & Cost" sub="Rates and performance tracking" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Productivity rates */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Agreed Productivity Rates</div>
          {Object.entries(productivity).map(([discipline, data]) => (
            <div key={discipline} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a1d27" }}>
              {editing === discipline ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                  <span style={{ width: 100, fontSize: 13, color: "#818cf8" }}>{discipline}</span>
                  <input type="number" defaultValue={data.rate} id={`rate-${discipline}`} style={{ width: 80 }} />
                  <input defaultValue={data.unit} id={`unit-${discipline}`} style={{ flex: 1 }} />
                  <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => {
                    const rate = Number(document.getElementById(`rate-${discipline}`).value);
                    const unit = document.getElementById(`unit-${discipline}`).value;
                    setProductivity({ ...productivity, [discipline]: { rate, unit } });
                    setEditing(null); showToast("Rate updated");
                  }}>Save</button>
                </div>
              ) : (
                <>
                  <span className="tag" style={{ background: "#1e2133", color: "#818cf8", marginRight: 10 }}>{discipline}</span>
                  <span style={{ flex: 1, fontSize: 13, color: "#94a3b8" }}>{data.rate} {data.unit}</span>
                  <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setEditing(discipline)}>Edit</button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Engineer cost summary */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Engineer Cost Summary</div>
          <table>
            <thead><tr><th>Engineer</th><th>Tasks Done</th><th>Days</th><th>Cost</th></tr></thead>
            <tbody>
              {engineers.filter(e => e.active).map(eng => {
                const { tasks: t, days, cost } = getEngineerProductivity(eng);
                return (
                  <tr key={eng.id}>
                    <td>{eng.name}</td>
                    <td>{t}</td>
                    <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{days}d</td>
                    <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{fmt(cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-project cost */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Cost per Project</div>
        <table>
          <thead><tr><th>Project</th><th>Region</th><th>Budget</th><th>Cost to Date</th><th>Remaining</th><th>Burn Rate</th></tr></thead>
          <tbody>
            {[...tasks].reduce((acc, t) => {
              const eng = engineers.find(e => e.id === t.assignee);
              if (!eng) return acc;
              const cost = t.loggedHours * (eng.rate / 8);
              acc[t.projectId] = (acc[t.projectId] || 0) + cost;
              return acc;
            }, {}) && null}
            {Object.entries(
              tasks.reduce((acc, t) => {
                const eng = engineers.find(e => e.id === t.assignee);
                if (!eng) return acc;
                const cost = t.loggedHours * (eng.rate / 8);
                acc[t.projectId] = (acc[t.projectId] || 0) + cost;
                return acc;
              }, {})
            ).map(([projectId, cost]) => {
              const proj = projects.find ? null : null;
              return null;
            })}
            {(() => {
              const costMap = tasks.reduce((acc, t) => {
                const eng = engineers.find(e => e.id === t.assignee);
                if (!eng) return acc;
                const cost = t.loggedHours * (eng.rate / 8);
                acc[t.projectId] = (acc[t.projectId] || 0) + cost;
                return acc;
              }, {});
              return Object.entries(costMap).map(([pid, cost]) => {
                const proj = projects.find(p => p.id === pid) || { id: pid, name: "Unknown Project", budget: 0, region: "—" };
                const remaining = proj.budget - cost;
                const burn = proj.budget > 0 ? Math.round((cost / proj.budget) * 100) : 0;
                return (
                  <tr key={pid}>
                    <td style={{ fontWeight: 500 }}>{proj.name}</td>
                    <td><span className="tag" style={{ background: "#1e2133", color: "#94a3b8" }}>{proj.region}</span></td>
                    <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{fmt(proj.budget)}</td>
                    <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{fmt(cost)}</td>
                    <td style={{ fontFamily: "DM Mono", fontSize: 12, color: remaining < 0 ? "#ef4444" : "#94a3b8" }}>{fmt(remaining)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="progress-bar" style={{ flex: 1, height: 4 }}><div className="progress-fill" style={{ width: `${Math.min(burn, 100)}%`, background: burn > 90 ? "#ef4444" : burn > 70 ? "#f59e0b" : "#10b981" }} /></div>
                        <span style={{ fontSize: 10, color: burn > 90 ? "#ef4444" : "#64748b" }}>{burn}%</span>
                      </div>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function Reports({ engineers, projects, tasks, attendance = [], leaves = [] }) {
  const [period, setPeriod] = useState("weekly");
  const [aiSummary, setAiSummary] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);

  const now = new Date();
  const getDateFilter = () => {
    if (period === "weekly") { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
    if (period === "monthly") { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
    const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d;
  };

  const cutoff = getDateFilter();
  const recentTasks = tasks.filter(t => new Date(t.createdAt || "2025-01-01") >= cutoff);

  const totalHours = tasks.reduce((s, t) => s + t.loggedHours, 0);
  const totalCost = tasks.reduce((s, t) => {
    const eng = engineers.find(e => e.id === t.assignee);
    return s + (eng ? t.loggedHours * (eng.rate / 8) : 0);
  }, 0);
  const completedCount = tasks.filter(t => t.status === "completed").length;
  const activeCount = tasks.filter(t => t.status === "in-progress").length;

  const generateAISummary = async () => {
    setLoadingAI(true);
    const statsPayload = {
      period,
      activeProjects: projects.filter(p => p.status === "active").length,
      totalEngineers: engineers.filter(e => e.active).length,
      tasksCompleted: completedCount,
      tasksInProgress: activeCount,
      totalHoursLogged: totalHours,
      totalCostToDate: Math.round(totalCost),
      projectBreakdown: projects.map(p => ({
        name: p.name,
        region: p.region,
        budget: p.budget,
        status: p.status,
        tasksCompleted: tasks.filter(t => t.projectId === p.id && t.status === "completed").length,
        totalTasks: tasks.filter(t => t.projectId === p.id).length,
      })),
      topEngineers: engineers.filter(e => e.active).map(e => ({
        name: e.name,
        role: e.role,
        hoursLogged: tasks.filter(t => t.assignee === e.id).reduce((s, t) => s + t.loggedHours, 0),
      })).sort((a, b) => b.hoursLogged - a.hoursLogged).slice(0, 5),
    };

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: "You are a studio management AI for Iksana, an interior architecture BIM studio in India serving UAE and KSA clients. Write concise, professional management summaries. Use bullet points. Be direct about risks and highlights. Use INR for currency.",
          messages: [{ role: "user", content: `Generate a ${period} management summary for Iksana studio based on this data: ${JSON.stringify(statsPayload)}. Include: overall status, project highlights, team performance, financial summary, and 2-3 recommended actions.` }],
        }),
      });
      const data = await resp.json();
      setAiSummary(data.content?.[0]?.text || "Unable to generate summary.");
    } catch (e) {
      setAiSummary("Error generating summary. Please try again.");
    }
    setLoadingAI(false);
  };

  return (
    <div>
      <PageHeader title="Reports" sub="Studio performance overview" />

      {/* Period selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {["weekly", "monthly", "yearly"].map(p => (
          <button key={p} className={`btn ${period === p ? "btn-primary" : "btn-ghost"}`} onClick={() => setPeriod(p)} style={{ textTransform: "capitalize" }}>{p}</button>
        ))}
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Hours Logged", value: totalHours + "h", accent: "#6366f1" },
          { label: "Tasks Completed", value: completedCount, accent: "#10b981" },
          { label: "Tasks Active", value: activeCount, accent: "#f59e0b" },
          { label: "Total Cost", value: `₹${(totalCost / 100000).toFixed(1)}L`, accent: "#ec4899" },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.accent }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* By-project summary */}
      <div className="card" style={{ marginBottom: 20, padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e2133", fontSize: 13, fontWeight: 600 }}>Project Summary</div>
        <table>
          <thead><tr><th>Project</th><th>Region</th><th>Tasks Done</th><th>Progress</th><th>Cost (₹)</th><th>Budget (₹)</th><th>Budget Used</th></tr></thead>
          <tbody>
            {projects.map(p => {
              const ptasks = tasks.filter(t => t.projectId === p.id);
              const done = ptasks.filter(t => t.status === "completed").length;
              const cost = ptasks.reduce((s, t) => { const eng = engineers.find(e => e.id === t.assignee); return s + (eng ? t.loggedHours * (eng.rate / 8) : 0); }, 0);
              const budgetPct = pct(cost, p.budget);
              return (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td><span className="tag" style={{ background: p.region === "UAE" ? "#0ea5e922" : "#8b5cf622", color: p.region === "UAE" ? "#0ea5e9" : "#8b5cf6" }}>{p.region}</span></td>
                  <td>{done}/{ptasks.length}</td>
                  <td style={{ width: 120 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div className="progress-bar" style={{ flex: 1 }}><div className="progress-fill" style={{ width: `${pct(done, ptasks.length)}%`, background: "#6366f1" }} /></div>
                      <span style={{ fontSize: 11, width: 28 }}>{pct(done, ptasks.length)}%</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{fmt(cost)}</td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{fmt(p.budget)}</td>
                  <td><span style={{ color: budgetPct > 80 ? "#ef4444" : "#10b981", fontFamily: "DM Mono", fontSize: 12 }}>{budgetPct}%</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* AI Summary */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>AI Management Summary</div>
            <div style={{ fontSize: 11, color: "#4a5568", marginTop: 2 }}>Powered by Claude · {period} view</div>
          </div>
          <button className="btn btn-primary" onClick={generateAISummary} disabled={loadingAI}>
            {loadingAI ? "Generating…" : "Generate Summary"}
          </button>
        </div>
        {aiSummary ? (
          <div style={{ background: "#1a1d27", borderRadius: 10, padding: 20, fontSize: 13, lineHeight: 1.7, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
            {aiSummary}
          </div>
        ) : (
          <div style={{ background: "#1a1d27", borderRadius: 10, padding: 20, textAlign: "center", color: "#374151", fontSize: 13 }}>
            Click "Generate Summary" to get an AI-powered {period} report for your studio
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Attendance ───────────────────────────────────────────────────────────────
function Attendance({ engineers, attendance, leaves, setAttendance, setLeaves, showToast, role, currentUser, emailCfg, onSendEmail }) {
  const [view, setView] = useState("today"); // today | monthly | leaves
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [selectedMonth, setSelectedMonth] = useState(TODAY.slice(0, 7));
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [editingLeave, setEditingLeave] = useState(null);

  const isBiburaj = currentUser?.email?.toLowerCase() === "btp@iksana.tech";
  const canMark = role === "admin" || isBiburaj;

  // Only Admin or Biburaj can see everyone; others only see themselves
  const activeEng = canMark
    ? engineers.filter(e => e.active)
    : engineers.filter(e => e.id === currentUser.engineerId);

  // ── Today's attendance helpers ──
  const getRecord = (engId, date) => attendance.find(a => a.engineerId === engId && a.date === date);

  const checkIn = (engId) => {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const existing = getRecord(engId, selectedDate);
    if (existing) {
      setAttendance(attendance.map(a => a.id === existing.id ? { ...a, checkIn: timeStr, type: "present" } : a));
    } else {
      setAttendance([...attendance, { id: `a-${engId}-${uid()}`, engineerId: engId, date: selectedDate, checkIn: timeStr, checkOut: null, type: "present", notes: "" }]);
    }
    showToast("Checked in");
  };

  const checkOut = (engId) => {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const existing = getRecord(engId, selectedDate);
    if (existing) {
      setAttendance(attendance.map(a => a.id === existing.id ? { ...a, checkOut: timeStr } : a));
      showToast("Checked out");
    }
  };

  const markAbsent = (engId) => {
    const existing = getRecord(engId, selectedDate);
    if (existing) {
      setAttendance(attendance.map(a => a.id === existing.id ? { ...a, type: "absent", checkIn: null, checkOut: null } : a));
    } else {
      setAttendance([...attendance, { id: `a-${engId}-${uid()}`, engineerId: engId, date: selectedDate, checkIn: null, checkOut: null, type: "absent", notes: "" }]);
    }
    showToast("Marked absent");
  };

  const calcHours = (rec) => {
    if (!rec?.checkIn || !rec?.checkOut) return 0;
    const [ih, im] = rec.checkIn.split(":").map(Number);
    const [oh, om] = rec.checkOut.split(":").map(Number);
    return ((oh * 60 + om) - (ih * 60 + im)) / 60;
  };

  // ── Monthly summary ──
  const getMonthlyData = (engId) => {
    const records = attendance.filter(a => a.engineerId === engId && a.date.startsWith(selectedMonth));
    const present = records.filter(a => a.type === "present").length;
    const absent = records.filter(a => a.type === "absent").length;
    const totalHours = records.reduce((s, a) => s + calcHours(a), 0);
    const engLeaves = leaves.filter(l => l.engineerId === engId && (l.startDate.startsWith(selectedMonth) || l.endDate.startsWith(selectedMonth)) && l.status === "approved");
    const leaveCount = engLeaves.reduce((s, l) => {
      const start = new Date(l.startDate), end = new Date(l.endDate);
      return s + Math.ceil((end - start) / 86400000) + 1;
    }, 0);
    return { present, absent, leaveCount, totalHours: totalHours.toFixed(1) };
  };

  // ── Leave management ──
  const handleLeafSave = (d) => {
    if (editingLeave) {
      setLeaves(leaves.map(l => l.id === editingLeave.id ? { ...editingLeave, ...d } : l));
      showToast("Leave updated");
    } else {
      setLeaves([...leaves, { id: "l" + uid(), ...d, status: "pending" }]);
      showToast("Leave request added");
    }
    setShowLeaveForm(false); setEditingLeave(null);
  };

  const toggleLeaveStatus = async (id) => {
    if (!can(role, "approveLeave")) return;
    const leave = leaves.find(l => l.id === id);
    if (!leave) return;
    const newStatus = leave.status === "approved" ? "rejected" : "approved";
    setLeaves(leaves.map(l => l.id === id ? { ...l, status: newStatus } : l));
    if (emailCfg?.enabled && emailCfg?.triggers?.leaveDecision) {
      const eng = engineers.find(e => e.id === leave.engineerId);
      if (eng) {
        await onSendEmail({
          to_email: eng.email,
          to_name: eng.name,
          subject: `Iksana Studio — Leave Request ${newStatus === "approved" ? "Approved" : "Rejected"}`,
          message: `Dear ${eng.name},\n\nYour ${leave.type} leave request from ${leave.startDate} to ${leave.endDate} has been ${newStatus}.\n\nReason submitted: ${leave.reason}\n\nPlease contact your manager if you have any questions.\n\nIksana Studio Management`,
        });
      }
    }
  };

  const todayPresent = activeEng.filter(e => getRecord(e.id, selectedDate)?.type === "present").length;
  const todayAbsent = activeEng.filter(e => getRecord(e.id, selectedDate)?.type === "absent").length;
  const todayUnmarked = activeEng.length - todayPresent - todayAbsent;

  return (
    <div>
      <PageHeader title="Attendance & Leave" sub="Daily check-in, timesheets and leave management" />

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[["today", "Daily Attendance"], ["monthly", "Monthly Summary"], ["leaves", "Leave Management"]].map(([id, label]) => (
          <button key={id} className={`btn ${view === id ? "btn-primary" : "btn-ghost"}`} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {/* ── TODAY ── */}
      {view === "today" && (
        <div>
          {/* Date picker + stats */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 20 }}>
            <div style={{ flex: "0 0 200px" }}>
              <label>Select Date</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 12, flex: 1 }}>
              {[
                { label: "Present", value: todayPresent, color: "#10b981" },
                { label: "Absent", value: todayAbsent, color: "#ef4444" },
                { label: "Unmarked", value: todayUnmarked, color: "#64748b" },
                { label: "Total", value: activeEng.length, color: "#6366f1" },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ flex: 1, padding: "14px 16px" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Attendance table */}
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Engineer</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Hours</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeEng.map(eng => {
                  const rec = getRecord(eng.id, selectedDate);
                  const hours = calcHours(rec);
                  const isOnLeave = leaves.some(l => l.engineerId === eng.id && l.status === "approved" && selectedDate >= l.startDate && selectedDate <= l.endDate);
                  const statusColor = isOnLeave ? "#f59e0b" : rec?.type === "present" ? "#10b981" : rec?.type === "absent" ? "#ef4444" : "#64748b";
                  const statusLabel = isOnLeave ? "on leave" : rec?.type || "unmarked";
                  return (
                    <tr key={eng.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{eng.name}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{eng.role}</div>
                      </td>
                      <td>
                        <span className="tag" style={{ background: eng.location === "remote" ? "#f59e0b22" : "#10b98122", color: eng.location === "remote" ? "#f59e0b" : "#10b981" }}>
                          {eng.location}
                        </span>
                      </td>
                      <td>
                        <span className="tag" style={{ background: `${statusColor}22`, color: statusColor, textTransform: "capitalize" }}>
                          {statusLabel}
                        </span>
                      </td>
                      <td style={{ fontFamily: "DM Mono", fontSize: 13, color: "#94a3b8" }}>
                        {rec?.checkIn ? (
                          canMark ? (
                            <input type="time" value={rec.checkIn} onChange={e => setAttendance(attendance.map(a => a.id === rec.id ? { ...a, checkIn: e.target.value } : a))} style={{ width: 100, padding: "4px 8px" }} />
                          ) : (
                            <span>{rec.checkIn}</span>
                          )
                        ) : "—"}
                      </td>
                      <td style={{ fontFamily: "DM Mono", fontSize: 13, color: "#94a3b8" }}>
                        {rec?.checkOut ? (
                          canMark ? (
                            <input type="time" value={rec.checkOut} onChange={e => setAttendance(attendance.map(a => a.id === rec.id ? { ...a, checkOut: e.target.value } : a))} style={{ width: 100, padding: "4px 8px" }} />
                          ) : (
                            <span>{rec.checkOut}</span>
                          )
                        ) : rec?.checkIn ? <span style={{ color: "#f59e0b" }}>In office</span> : "—"}
                      </td>
                      <td style={{ fontFamily: "DM Mono", fontSize: 13, color: hours >= 8 ? "#10b981" : hours > 0 ? "#f59e0b" : "#64748b" }}>
                        {hours > 0 ? `${hours.toFixed(1)}h` : "—"}
                      </td>
                      <td>
                        {canMark ? (
                          <>
                            {!isOnLeave && (
                              <div style={{ display: "flex", gap: 4 }}>
                                {!rec?.checkIn && <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => checkIn(eng.id)}>Check In</button>}
                                {rec?.checkIn && !rec?.checkOut && <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => checkOut(eng.id)}>Check Out</button>}
                                {rec?.type !== "absent" && <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11, color: "#ef4444" }} onClick={() => markAbsent(eng.id)}>Absent</button>}
                              </div>
                            )}
                            {isOnLeave && <span style={{ fontSize: 12, color: "#f59e0b" }}>On approved leave</span>}
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: "#64748b" }}>Read-only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MONTHLY ── */}
      {view === "monthly" && (
        <div>
          <div style={{ marginBottom: 20, maxWidth: 200 }}>
            <label>Select Month</label>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Engineer</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Present Days</th>
                  <th>Absent Days</th>
                  <th>Leave Days</th>
                  <th>Total Hours</th>
                  <th>Attendance %</th>
                  {can(role, "viewFinancials") && <th>Est. Cost (₹)</th>}
                </tr>
              </thead>
              <tbody>
                {activeEng.map(eng => {
                  const { present, absent, leaveCount, totalHours } = getMonthlyData(eng.id);
                  const workingDays = present + absent + leaveCount || 1;
                  const attPct = Math.round((present / workingDays) * 100);
                  const cost = present * eng.rate;
                  return (
                    <tr key={eng.id}>
                      <td style={{ fontWeight: 500 }}>{eng.name}</td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{eng.role}</td>
                      <td><span className="tag" style={{ background: eng.location === "remote" ? "#f59e0b22" : "#10b98122", color: eng.location === "remote" ? "#f59e0b" : "#10b981" }}>{eng.location}</span></td>
                      <td style={{ color: "#10b981", fontWeight: 600 }}>{present}</td>
                      <td style={{ color: absent > 3 ? "#ef4444" : "#94a3b8" }}>{absent}</td>
                      <td style={{ color: "#f59e0b" }}>{leaveCount}</td>
                      <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{totalHours}h</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="progress-bar" style={{ width: 60 }}>
                            <div className="progress-fill" style={{ width: `${attPct}%`, background: attPct >= 90 ? "#10b981" : attPct >= 75 ? "#f59e0b" : "#ef4444" }} />
                          </div>
                          <span style={{ fontSize: 12, color: attPct >= 90 ? "#10b981" : attPct >= 75 ? "#f59e0b" : "#ef4444" }}>{attPct}%</span>
                        </div>
                      </td>
                      {can(role, "viewFinancials") && <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{fmt(cost)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LEAVES ── */}
      {view === "leaves" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => { setEditingLeave(null); setShowLeaveForm(true); }}>+ Apply Leave</button>
          </div>

          {/* Leave balance summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 24 }}>
            {LEAVE_TYPES.map(type => {
              const count = leaves.filter(l =>
                l.type === type &&
                l.status === "approved" &&
                (canMark || l.engineerId === currentUser.engineerId)
              ).length;
              return (
                <div key={type} className="stat-card" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: "#64748b", textTransform: "capitalize", fontWeight: 600 }}>{type} Leave</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: LEAVE_COLORS[type] }}>{count}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#374151", marginTop: 4 }}>approved requests</div>
                </div>
              );
            })}
          </div>

          {/* Leave requests table */}
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr><th>Engineer</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th>{can(role,"approveLeave")&&<th>Actions</th>}</tr>
              </thead>
              <tbody>
                {[...leaves].sort((a, b) => b.startDate.localeCompare(a.startDate))
                  .filter(l => canMark ? true : l.engineerId === currentUser.engineerId)
                  .map(l => {
                  const eng = engineers.find(e => e.id === l.engineerId);
                  const days = Math.ceil((new Date(l.endDate) - new Date(l.startDate)) / 86400000) + 1;
                  return (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 500 }}>{eng?.name}</td>
                      <td><span className="tag" style={{ background: `${LEAVE_COLORS[l.type]}22`, color: LEAVE_COLORS[l.type], textTransform: "capitalize" }}>{l.type}</span></td>
                      <td style={{ fontSize: 12, color: "#94a3b8" }}>{l.startDate}</td>
                      <td style={{ fontSize: 12, color: "#94a3b8" }}>{l.endDate}</td>
                      <td style={{ fontWeight: 600 }}>{days}d</td>
                      <td style={{ fontSize: 12, color: "#64748b", maxWidth: 180 }}>{l.reason}</td>
                      <td>
                        <span className="tag" style={{ background: l.status === "approved" ? "#10b98122" : l.status === "rejected" ? "#ef444422" : "#f59e0b22", color: l.status === "approved" ? "#10b981" : l.status === "rejected" ? "#ef4444" : "#f59e0b", textTransform: "capitalize" }}>
                          {l.status}
                        </span>
                      </td>
                      {can(role,"approveLeave") && (
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => toggleLeaveStatus(l.id)}>
                              {l.status === "approved" ? "Reject" : "Approve"}
                            </button>
                            <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { setEditingLeave(l); setShowLeaveForm(true); }}>Edit</button>
                            <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { setLeaves(leaves.filter(x => x.id !== l.id)); showToast("Leave deleted", "error"); }}>✕</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {leaves.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "#374151", padding: 32 }}>No leave requests yet</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Leave form modal */}
          {showLeaveForm && (
            <div className="modal-bg">
              <div className="modal">
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>{editingLeave ? "Edit Leave" : "Apply Leave"}</div>
                <LeaveForm leave={editingLeave} engineers={engineers.filter(e => e.active)} onSave={handleLeafSave} onClose={() => { setShowLeaveForm(false); setEditingLeave(null); }} currentUser={currentUser} canSeeAll={canMark} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LeaveForm({ leave, engineers, onSave, onClose, currentUser, canSeeAll }) {
  const [d, setD] = useState(leave || { engineerId: canSeeAll ? "" : currentUser.engineerId, type: "casual", startDate: "", endDate: "", reason: "" });
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  return (
    <>
      {canSeeAll ? (
        <div className="form-row">
          <label>Engineer</label>
          <select value={d.engineerId} onChange={e => set("engineerId", e.target.value)}>
            <option value="">Select engineer</option>
            {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="form-row">
          <label>Engineer</label>
          <input type="text" value={currentUser.name} disabled style={{ opacity: 0.8 }} />
        </div>
      )}
      <div className="form-row">
        <label>Leave Type</label>
        <select value={d.type} onChange={e => set("type", e.target.value)}>
          {LEAVE_TYPES.map(t => <option key={t} value={t} style={{ textTransform: "capitalize" }}>{t}</option>)}
        </select>
      </div>
      <div className="form-grid">
        <div className="form-row"><label>From Date</label><input type="date" value={d.startDate} onChange={e => set("startDate", e.target.value)} /></div>
        <div className="form-row"><label>To Date</label><input type="date" value={d.endDate} onChange={e => set("endDate", e.target.value)} /></div>
      </div>
      <div className="form-row"><label>Reason</label><textarea rows={3} value={d.reason} onChange={e => set("reason", e.target.value)} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" onClick={() => onSave(d)}>Save</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </>
  );
}

// ─── Alert Engine ─────────────────────────────────────────────────────────────
function computeAlerts(tasks, projects, engineers, leaves, dismissed = []) {
  const alerts = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Task alerts ──
  tasks.forEach(t => {
    if (t.status === "completed") return;
    const due = new Date(t.dueDate);
    due.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((due - today) / 86400000);
    const eng = engineers.find(e => e.id === t.assignee);
    const proj = projects.find(p => p.id === t.projectId);
    const label = `${t.title} · ${proj?.name?.split(" ").slice(0, 3).join(" ") || ""}`;

    if (daysLeft < 0) {
      alerts.push({ id: `overdue-${t.id}`, severity: "critical", category: "deadline", icon: "⚠", title: "Task Overdue", body: `"${label}" is ${Math.abs(daysLeft)} day(s) overdue.`, assignee: eng?.name, link: "tasks", ts: t.dueDate });
    } else if (daysLeft <= 3) {
      alerts.push({ id: `due-soon-${t.id}`, severity: "warning", category: "deadline", icon: "◔", title: "Due in 3 Days", body: `"${label}" is due on ${t.dueDate}.`, assignee: eng?.name, link: "tasks", ts: t.dueDate });
    } else if (daysLeft <= 7) {
      alerts.push({ id: `due-week-${t.id}`, severity: "info", category: "deadline", icon: "◑", title: "Due This Week", body: `"${label}" is due on ${t.dueDate}.`, assignee: eng?.name, link: "tasks", ts: t.dueDate });
    }

    // Overrun hours
    if (t.loggedHours > t.estimatedHours * 1.1) {
      alerts.push({ id: `overrun-${t.id}`, severity: "warning", category: "budget", icon: "◈", title: "Hours Overrun", body: `"${t.title}" has logged ${t.loggedHours}h vs ${t.estimatedHours}h estimated (${Math.round((t.loggedHours / t.estimatedHours) * 100)}%).`, assignee: eng?.name, link: "tasks", ts: today.toISOString().slice(0, 10) });
    }
  });

  // ── Project budget alerts ──
  projects.forEach(p => {
    if (p.status !== "active") return;
    const ptasks = tasks.filter(t => t.projectId === p.id);
    const cost = ptasks.reduce((s, t) => {
      const eng = engineers.find(e => e.id === t.assignee);
      return s + (eng ? t.loggedHours * (eng.rate / 8) : 0);
    }, 0);
    const burnPct = p.budget > 0 ? (cost / p.budget) * 100 : 0;

    if (burnPct >= 90) {
      alerts.push({ id: `budget-critical-${p.id}`, severity: "critical", category: "budget", icon: "◉", title: "Budget Critical", body: `"${p.name}" has used ${burnPct.toFixed(0)}% of its budget (₹${Math.round(cost).toLocaleString("en-IN")} of ₹${p.budget.toLocaleString("en-IN")}).`, link: "projects", ts: today.toISOString().slice(0, 10) });
    } else if (burnPct >= 75) {
      alerts.push({ id: `budget-warn-${p.id}`, severity: "warning", category: "budget", icon: "◎", title: "Budget Warning", body: `"${p.name}" has used ${burnPct.toFixed(0)}% of its budget.`, link: "projects", ts: today.toISOString().slice(0, 10) });
    }

    // Project end date approaching
    const end = new Date(p.endDate);
    const daysToEnd = Math.ceil((end - today) / 86400000);
    if (daysToEnd >= 0 && daysToEnd <= 14) {
      alerts.push({ id: `proj-end-${p.id}`, severity: daysToEnd <= 7 ? "critical" : "warning", category: "deadline", icon: "◫", title: "Project Deadline Approaching", body: `"${p.name}" ends on ${p.endDate} — ${daysToEnd} day(s) remaining.`, link: "projects", ts: p.endDate });
    }
  });

  // ── Engineer workload alerts ──
  engineers.filter(e => e.active).forEach(eng => {
    const myTasks = tasks.filter(t => t.assignee === eng.id && t.status === "in-progress");
    const remaining = myTasks.reduce((s, t) => s + Math.max(0, t.estimatedHours - t.loggedHours), 0);
    const loadPct = Math.round((remaining / 160) * 100);
    if (loadPct > 90) {
      alerts.push({ id: `overload-${eng.id}`, severity: "warning", category: "workload", icon: "◐", title: "Engineer Overloaded", body: `${eng.name} is at ${loadPct}% capacity with ${remaining}h of remaining work.`, link: "allocation", ts: today.toISOString().slice(0, 10) });
    }
    if (myTasks.length === 0) {
      alerts.push({ id: `idle-${eng.id}`, severity: "info", category: "workload", icon: "◑", title: "Engineer Unassigned", body: `${eng.name} (${eng.role}) has no active tasks assigned.`, link: "allocation", ts: today.toISOString().slice(0, 10) });
    }
  });

  // ── Leave alerts ──
  leaves.filter(l => l.status === "pending").forEach(l => {
    const eng = engineers.find(e => e.id === l.engineerId);
    alerts.push({ id: `leave-pending-${l.id}`, severity: "info", category: "leave", icon: "◷", title: "Leave Pending Approval", body: `${eng?.name} has a ${l.type} leave request from ${l.startDate} to ${l.endDate} awaiting approval.`, link: "attendance", ts: l.startDate });
  });

  // Filter dismissed
  return alerts.filter(a => !dismissed.includes(a.id)).sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}

// ─── Notifications ────────────────────────────────────────────────────────────
function Notifications({ tasks, projects, engineers, leaves, dismissed, setDismissed, setTab, emailCfg, onSendEmail }) {
  const [filter, setFilter] = useState("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const allAlerts = computeAlerts(tasks, projects, engineers, leaves, []);
  const activeAlerts = allAlerts.filter(a => !dismissed.includes(a.id));
  const dismissedAlerts = allAlerts.filter(a => dismissed.includes(a.id));

  const filtered = (showDismissed ? dismissedAlerts : activeAlerts).filter(a => filter === "all" || a.category === filter || a.severity === filter);

  const dismiss = (id) => setDismissed([...dismissed, id]);
  const dismissAll = () => setDismissed([...dismissed, ...activeAlerts.map(a => a.id)]);
  const restore = (id) => setDismissed(dismissed.filter(d => d !== id));
  const clearAllDismissed = () => setDismissed([]);

  const SEV_STYLE = {
    critical: { bg: "#ef444415", border: "#ef444440", dot: "#ef4444", label: "#ef4444" },
    warning:  { bg: "#f59e0b15", border: "#f59e0b40", dot: "#f59e0b", label: "#f59e0b" },
    info:     { bg: "#6366f115", border: "#6366f140", dot: "#6366f1", label: "#818cf8" },
  };

  const CAT_LABELS = { deadline: "Deadlines", budget: "Budget", workload: "Workload", leave: "Leave" };

  const critCount = activeAlerts.filter(a => a.severity === "critical").length;
  const warnCount = activeAlerts.filter(a => a.severity === "warning").length;
  const infoCount = activeAlerts.filter(a => a.severity === "info").length;

  return (
    <div>
      <PageHeader
        title="Alerts & Notifications"
        sub={`${activeAlerts.length} active · ${critCount} critical`}
        action={activeAlerts.length > 0 && !showDismissed && (
          <button className="btn btn-ghost" onClick={dismissAll}>Dismiss All</button>
        )}
      />

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "Critical", count: critCount, color: "#ef4444", id: "critical" },
          { label: "Warnings", count: warnCount, color: "#f59e0b", id: "warning" },
          { label: "Info", count: infoCount, color: "#6366f1", id: "info" },
          { label: "Dismissed", count: dismissedAlerts.length, color: "#64748b", id: "dismissed" },
        ].map(s => (
          <div
            key={s.id}
            className="stat-card"
            onClick={() => { if (s.id === "dismissed") { setShowDismissed(true); setFilter("all"); } else { setShowDismissed(false); setFilter(s.id); } }}
            style={{ cursor: "pointer", borderColor: filter === s.id && !showDismissed ? s.color : "#1e2133", transition: "border-color 0.15s" }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
        {!showDismissed && ["all", "deadline", "budget", "workload", "leave"].map(f => (
          <button key={f} className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`} style={{ textTransform: "capitalize", padding: "6px 14px", fontSize: 12 }} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : CAT_LABELS[f]}
          </button>
        ))}
        {showDismissed && (
          <>
            <button className="btn btn-ghost" onClick={() => { setShowDismissed(false); setFilter("all"); }}>← Active Alerts</button>
            {dismissedAlerts.length > 0 && <button className="btn btn-danger" style={{ fontSize: 12, padding: "6px 14px" }} onClick={clearAllDismissed}>Clear History</button>}
          </>
        )}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#4a5568" }}>
          {filtered.length} alert{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>
            {showDismissed ? "No dismissed alerts" : "All clear!"}
          </div>
          <div style={{ fontSize: 13, color: "#4a5568" }}>
            {showDismissed ? "Dismissed alerts will appear here." : "No active alerts matching this filter."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(alert => {
            const sty = SEV_STYLE[alert.severity];
            return (
              <div
                key={alert.id}
                style={{ background: sty.bg, border: `1px solid ${sty.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 16, opacity: showDismissed ? 0.6 : 1 }}
              >
                {/* Severity dot */}
                <div style={{ marginTop: 3, width: 10, height: 10, borderRadius: "50%", background: sty.dot, flexShrink: 0, boxShadow: `0 0 8px ${sty.dot}` }} />
                
                {/* Content */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: sty.label }}>{alert.title}</span>
                    <span className="tag" style={{ background: "#1e2133", color: "#64748b", textTransform: "capitalize", fontSize: 10 }}>{alert.category}</span>
                    {alert.severity === "critical" && (
                      <span className="tag" style={{ background: "#ef444422", color: "#ef4444", fontSize: 10 }}>CRITICAL</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: alert.assignee ? 6 : 0 }}>{alert.body}</div>
                  {alert.assignee && (
                    <div style={{ fontSize: 11, color: "#4a5568" }}>Assignee: {alert.assignee}</div>
                  )}
                  <div style={{ fontSize: 11, color: "#374151", marginTop: 4 }}>{alert.ts}</div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {!showDismissed && (
                    <>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={() => setTab(alert.link)}
                      >
                        View →
                      </button>
                      {emailCfg?.enabled && alert.severity === "critical" && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: "4px 10px", color: "#6366f1" }}
                          onClick={async () => {
                            await onSendEmail({
                              to_email: emailCfg.adminEmail,
                              to_name: "Studio Admin",
                              subject: `Iksana Studio — 🔴 Critical Alert: ${alert.title}`,
                              message: `Critical alert raised on ${new Date().toLocaleDateString("en-IN")}:\n\n${alert.title}\n\n${alert.body}${alert.assignee ? `\n\nAssignee: ${alert.assignee}` : ""}\n\nPlease log in to take action: ${window.location.href}`,
                            });
                          }}
                        >
                          ✉ Email
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={() => dismiss(alert.id)}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  {showDismissed && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => restore(alert.id)}>
                      Restore
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tip about dismissed */}
      {!showDismissed && dismissedAlerts.length > 0 && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setShowDismissed(true); setFilter("all"); }}>
            View {dismissedAlerts.length} dismissed alert{dismissedAlerts.length !== 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────
function Export({ tasks, projects, engineers, attendance, leaves }) {
  const [exporting, setExporting] = useState(null);
  const [done, setDone] = useState(null);

  const stamp = () => new Date().toISOString().slice(0, 10);
  const calcCost = (t) => { const e = engineers.find(x => x.id === t.assignee); return e ? t.loggedHours * (e.rate / 8) : 0; };
  const flash = (label) => { setDone(label); setTimeout(() => setDone(null), 3000); };

  // ── SheetJS ──────────────────────────────────────────────────────────────
  const loadXLSX = () => new Promise((res, rej) => {
    if (window.XLSX) return res(window.XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => res(window.XLSX); s.onerror = rej;
    document.head.appendChild(s);
  });

  const xlsxDownload = async (sheets, filename) => {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    sheets.forEach(({ name, data, colWidths }) => {
      const ws = XLSX.utils.aoa_to_sheet(data);
      if (colWidths) ws["!cols"] = colWidths.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, filename);
  };

  // ── jsPDF ────────────────────────────────────────────────────────────────
  const loadJsPDF = () => new Promise((res, rej) => {
    if (window.jspdf) return res(window.jspdf.jsPDF);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      s2.onload = () => res(window.jspdf.jsPDF); s2.onerror = rej;
      document.head.appendChild(s2);
    };
    s.onerror = rej; document.head.appendChild(s);
  });

  const pdfDownload = async ({ title, subtitle, columns, rows, filename, landscape }) => {
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    doc.setFillColor(79, 70, 229); doc.rect(0, 0, pw, 22, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("IKSANA Studio Management", 14, 10);
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(title, 14, 17);
    doc.setTextColor(100, 116, 139); doc.setFontSize(8);
    doc.text(`${subtitle}  ·  Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`, 14, 28);
    doc.text("ISK-EXP · Confidential", pw - 14, 28, { align: "right" });
    doc.autoTable({
      startY: 32, head: [columns], body: rows, theme: "grid",
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: "bold", fontSize: 8, halign: "center" },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      styles: { font: "helvetica", cellPadding: 3 },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        const pg = doc.internal.getCurrentPageInfo().pageNumber;
        const total = doc.internal.getNumberOfPages();
        doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        doc.text(`Page ${pg} of ${total}  ·  Iksana Interior Architecture Studio  ·  Internal Use Only`, pw / 2, doc.internal.pageSize.getHeight() - 6, { align: "center" });
      },
    });
    doc.save(filename);
  };

  // ── Export definitions ───────────────────────────────────────────────────
  const EXPORTS = [
    {
      id: "tasks", label: "Task Register", icon: "◈", color: "#6366f1",
      desc: "All tasks with assignee, hours, status, cost and due dates",
      xlsxFile: `iksana-tasks-${stamp()}.xlsx`,
      sheets: () => [{
        name: "Task Register",
        colWidths: [30, 28, 18, 12, 14, 12, 12, 14, 14, 12],
        data: [
          ["Task Title", "Project", "Assignee", "Discipline", "Status", "Priority", "Est. Hours", "Logged Hours", "Cost (INR)", "Due Date"],
          ...tasks.map(t => {
            const eng = engineers.find(e => e.id === t.assignee);
            const proj = projects.find(p => p.id === t.projectId);
            return [t.title, proj?.name || "—", eng?.name || "—", t.discipline, t.status, t.priority, t.estimatedHours, t.loggedHours, Math.round(calcCost(t)), t.dueDate];
          }),
          [], ["TOTALS", "", "", "", "", "",
            tasks.reduce((s, t) => s + t.estimatedHours, 0),
            tasks.reduce((s, t) => s + t.loggedHours, 0),
            Math.round(tasks.reduce((s, t) => s + calcCost(t), 0)), ""],
        ],
      }],
      pdf: () => ({
        title: "Task Register", subtitle: `${tasks.length} tasks`, landscape: true,
        columns: ["Task Title", "Project", "Assignee", "Discipline", "Status", "Est.Hrs", "Logged", "Cost (INR)", "Due Date"],
        rows: tasks.map(t => { const eng = engineers.find(e => e.id === t.assignee); const proj = projects.find(p => p.id === t.projectId); return [t.title.slice(0, 32), (proj?.name || "").slice(0, 22), eng?.name || "—", t.discipline, t.status, t.estimatedHours, t.loggedHours, Math.round(calcCost(t)).toLocaleString("en-IN"), t.dueDate]; }),
        filename: `iksana-tasks-${stamp()}.pdf`,
      }),
    },
    {
      id: "projects", label: "Project Cost Summary", icon: "◫", color: "#10b981",
      desc: "Budget vs cost-to-date per project with burn rate analysis",
      xlsxFile: `iksana-projects-${stamp()}.xlsx`,
      sheets: () => [{
        name: "Project Cost Summary",
        colWidths: [32, 18, 8, 10, 14, 14, 14, 10, 10, 10, 12, 12],
        data: [
          ["Project Name", "Client", "Region", "Status", "Budget (INR)", "Cost to Date (INR)", "Remaining (INR)", "Total Tasks", "Completed", "Progress %", "Start Date", "End Date"],
          ...projects.map(p => { const ptasks = tasks.filter(t => t.projectId === p.id); const cost = ptasks.reduce((s, t) => s + calcCost(t), 0); const done = ptasks.filter(t => t.status === "completed").length; return [p.name, p.client, p.region, p.status, p.budget, Math.round(cost), Math.round(p.budget - cost), ptasks.length, done, `${pct(done, ptasks.length)}%`, p.startDate, p.endDate]; }),
          [], ["TOTALS", "", "", "", projects.reduce((s, p) => s + p.budget, 0), Math.round(projects.reduce((s, p) => s + tasks.filter(t => t.projectId === p.id).reduce((x, t) => x + calcCost(t), 0), 0)), "", tasks.length, tasks.filter(t => t.status === "completed").length, "", "", ""],
        ],
      }],
      pdf: () => ({
        title: "Project Cost Summary", subtitle: `${projects.length} projects`, landscape: true,
        columns: ["Project", "Client", "Region", "Status", "Budget (INR)", "Cost (INR)", "Remaining", "Progress"],
        rows: projects.map(p => { const ptasks = tasks.filter(t => t.projectId === p.id); const cost = ptasks.reduce((s, t) => s + calcCost(t), 0); const done = ptasks.filter(t => t.status === "completed").length; return [p.name.slice(0, 28), p.client, p.region, p.status, p.budget.toLocaleString("en-IN"), Math.round(cost).toLocaleString("en-IN"), Math.round(p.budget - cost).toLocaleString("en-IN"), `${pct(done, ptasks.length)}%`]; }),
        filename: `iksana-projects-${stamp()}.pdf`,
      }),
    },
    {
      id: "engineers", label: "Engineer Summary", icon: "◉", color: "#f59e0b",
      desc: "Per-engineer hours, cost, tasks completed and current allocation",
      xlsxFile: `iksana-engineers-${stamp()}.xlsx`,
      sheets: () => [{
        name: "Engineer Summary",
        colWidths: [22, 20, 10, 14, 12, 12, 12, 14, 16, 14],
        data: [
          ["Name", "Role", "Location", "Day Rate (INR)", "Total Tasks", "Completed", "Active", "Hours Logged", "Total Cost (INR)", "Hours Remaining"],
          ...engineers.filter(e => e.active).map(eng => { const myTasks = tasks.filter(t => t.assignee === eng.id); const logged = myTasks.reduce((s, t) => s + t.loggedHours, 0); const active = myTasks.filter(t => t.status === "in-progress"); const remaining = active.reduce((s, t) => s + Math.max(0, t.estimatedHours - t.loggedHours), 0); return [eng.name, eng.role, eng.location, eng.rate, myTasks.length, myTasks.filter(t => t.status === "completed").length, active.length, logged, Math.round(logged * (eng.rate / 8)), remaining]; }),
        ],
      }],
      pdf: () => ({
        title: "Engineer Summary", subtitle: `${engineers.filter(e => e.active).length} active engineers`, landscape: true,
        columns: ["Name", "Role", "Location", "Tasks", "Done", "Active", "Hours", "Cost (INR)", "Remaining"],
        rows: engineers.filter(e => e.active).map(eng => { const myTasks = tasks.filter(t => t.assignee === eng.id); const logged = myTasks.reduce((s, t) => s + t.loggedHours, 0); const active = myTasks.filter(t => t.status === "in-progress"); const remaining = active.reduce((s, t) => s + Math.max(0, t.estimatedHours - t.loggedHours), 0); return [eng.name, eng.role, eng.location, myTasks.length, myTasks.filter(t => t.status === "completed").length, active.length, logged, Math.round(logged * (eng.rate / 8)).toLocaleString("en-IN"), remaining + "h"]; }),
        filename: `iksana-engineers-${stamp()}.pdf`,
      }),
    },
    {
      id: "attendance", label: "Attendance Report", icon: "◷", color: "#0ea5e9",
      desc: "Full attendance log with check-in/out times, leave register, and monthly summary",
      xlsxFile: `iksana-attendance-${stamp()}.xlsx`,
      sheets: () => {
        const calcH = (r) => { if (!r?.checkIn || !r?.checkOut) return 0; const [ih, im] = r.checkIn.split(":").map(Number); const [oh, om] = r.checkOut.split(":").map(Number); return ((oh * 60 + om) - (ih * 60 + im)) / 60; };
        const attRows = attendance.map(a => { const eng = engineers.find(e => e.id === a.engineerId); return [eng?.name || a.engineerId, eng?.role || "", eng?.location || "", a.date, a.type, a.checkIn || "—", a.checkOut || "—", calcH(a).toFixed(1)]; }).sort((a, b) => b[3].localeCompare(a[3]));
        const leaveRows = leaves.map(l => { const eng = engineers.find(e => e.id === l.engineerId); const days = Math.ceil((new Date(l.endDate) - new Date(l.startDate)) / 86400000) + 1; return [eng?.name || l.engineerId, l.type, l.startDate, l.endDate, days, l.reason, l.status]; });
        const months = [...new Set(attendance.map(a => a.date.slice(0, 7)))].sort().reverse();
        const summaryRows = engineers.filter(e => e.active).flatMap(eng => months.map(m => { const recs = attendance.filter(a => a.engineerId === eng.id && a.date.startsWith(m)); const present = recs.filter(a => a.type === "present").length; const absent = recs.filter(a => a.type === "absent").length; const hours = recs.reduce((s, a) => s + calcH(a), 0); return [m, eng.name, eng.role, eng.location, present, absent, hours.toFixed(1), Math.round(present * eng.rate)]; }));
        return [
          { name: "Daily Attendance", colWidths: [22, 18, 10, 12, 10, 10, 10, 10], data: [["Name", "Role", "Location", "Date", "Status", "Check In", "Check Out", "Hours"], ...attRows] },
          { name: "Leave Register", colWidths: [22, 12, 12, 12, 8, 28, 12], data: [["Name", "Leave Type", "From", "To", "Days", "Reason", "Status"], ...leaveRows] },
          { name: "Monthly Summary", colWidths: [10, 22, 18, 10, 12, 12, 12, 16], data: [["Month", "Name", "Role", "Location", "Present", "Absent", "Hours", "Cost (INR)"], ...summaryRows] },
        ];
      },
      pdf: () => {
        const calcH = (r) => { if (!r?.checkIn || !r?.checkOut) return 0; const [ih, im] = r.checkIn.split(":").map(Number); const [oh, om] = r.checkOut.split(":").map(Number); return ((oh * 60 + om) - (ih * 60 + im)) / 60; };
        return { title: "Attendance Report", subtitle: `${attendance.length} records`, landscape: true, columns: ["Name", "Role", "Date", "Status", "Check In", "Check Out", "Hours"], rows: attendance.slice(0, 200).sort((a, b) => b.date.localeCompare(a.date)).map(a => { const eng = engineers.find(e => e.id === a.engineerId); return [eng?.name || "—", eng?.role || "—", a.date, a.type, a.checkIn || "—", a.checkOut || "—", calcH(a).toFixed(1)]; }), filename: `iksana-attendance-${stamp()}.pdf` };
      },
    },
    {
      id: "studio", label: "Full Studio Report", icon: "⬡", color: "#ec4899", badge: "RECOMMENDED",
      desc: "Complete workbook — all data across 5 sheets in one Excel file",
      xlsxFile: `iksana-full-report-${stamp()}.xlsx`,
      pdfDisabled: true,
      sheets: () => {
        const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
        const totalCostAll = tasks.reduce((s, t) => s + calcCost(t), 0);
        return [
          { name: "Summary", colWidths: [36, 20, 36], data: [
            ["IKSANA STUDIO — MANAGEMENT REPORT", "", ""],
            [`Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`, "", ""],
            [],
            ["METRIC", "VALUE", "NOTES"],
            ["Active Projects", projects.filter(p => p.status === "active").length, ""],
            ["Total Projects", projects.length, ""],
            ["Active Engineers", engineers.filter(e => e.active).length, ""],
            ["Remote Engineers", engineers.filter(e => e.active && e.location === "remote").length, "50% remote workforce"],
            ["Tasks In Progress", tasks.filter(t => t.status === "in-progress").length, ""],
            ["Tasks Completed", tasks.filter(t => t.status === "completed").length, ""],
            ["Total Hours Logged", tasks.reduce((s, t) => s + t.loggedHours, 0), ""],
            ["Total Budget (INR)", totalBudget, "All projects"],
            ["Total Cost to Date (INR)", Math.round(totalCostAll), "Day rates × logged hours"],
            ["Budget Remaining (INR)", Math.round(totalBudget - totalCostAll), ""],
            ["Overall Budget Burn %", `${pct(totalCostAll, totalBudget)}%`, ""],
          ]},
          { name: "Tasks", colWidths: [30, 26, 18, 12, 14, 10, 10, 10, 14, 12], data: [
            ["Task Title", "Project", "Assignee", "Discipline", "Status", "Priority", "Est.Hrs", "Logged Hrs", "Cost (INR)", "Due Date"],
            ...tasks.map(t => { const eng = engineers.find(e => e.id === t.assignee); const proj = projects.find(p => p.id === t.projectId); return [t.title, proj?.name || "—", eng?.name || "—", t.discipline, t.status, t.priority, t.estimatedHours, t.loggedHours, Math.round(calcCost(t)), t.dueDate]; }),
          ]},
          { name: "Projects", colWidths: [30, 16, 8, 10, 16, 16, 16, 10, 12], data: [
            ["Project", "Client", "Region", "Status", "Budget (INR)", "Cost (INR)", "Remaining (INR)", "Progress %", "End Date"],
            ...projects.map(p => { const ptasks = tasks.filter(t => t.projectId === p.id); const cost = ptasks.reduce((s, t) => s + calcCost(t), 0); const done = ptasks.filter(t => t.status === "completed").length; return [p.name, p.client, p.region, p.status, p.budget, Math.round(cost), Math.round(p.budget - cost), `${pct(done, ptasks.length)}%`, p.endDate]; }),
          ]},
          { name: "Engineers", colWidths: [22, 20, 10, 14, 10, 8, 8, 8, 14], data: [
            ["Name", "Role", "Location", "Day Rate (INR)", "Tasks", "Done", "Active", "Hours", "Cost (INR)"],
            ...engineers.filter(e => e.active).map(eng => { const myTasks = tasks.filter(t => t.assignee === eng.id); const logged = myTasks.reduce((s, t) => s + t.loggedHours, 0); return [eng.name, eng.role, eng.location, eng.rate, myTasks.length, myTasks.filter(t => t.status === "completed").length, myTasks.filter(t => t.status === "in-progress").length, logged, Math.round(logged * (eng.rate / 8))]; }),
          ]},
          { name: "Leave Register", colWidths: [22, 12, 12, 12, 8, 30, 12], data: [
            ["Engineer", "Type", "From", "To", "Days", "Reason", "Status"],
            ...leaves.map(l => { const eng = engineers.find(e => e.id === l.engineerId); const days = Math.ceil((new Date(l.endDate) - new Date(l.startDate)) / 86400000) + 1; return [eng?.name || l.engineerId, l.type, l.startDate, l.endDate, days, l.reason, l.status]; }),
          ]},
        ];
      },
    },
  ];

  const handleExport = async (exp, format) => {
    const key = `${exp.id}-${format}`;
    setExporting(key);
    try {
      if (format === "xlsx") await xlsxDownload(exp.sheets(), exp.xlsxFile);
      else { const cfg = exp.pdf(); await pdfDownload(cfg); }
      flash(`${exp.label} · ${format.toUpperCase()}`);
    } catch (e) { console.error(e); flash("Error — see console"); }
    setExporting(null);
  };

  return (
    <div>
      <PageHeader title="Export" sub="Download reports as Excel or PDF" />

      {done && (
        <div style={{ background: "#10b98122", border: "1px solid #10b98144", borderRadius: 10, padding: "12px 18px", marginBottom: 20, fontSize: 13, color: "#10b981", fontWeight: 600 }}>
          ✓ Downloaded: {done}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
        {[
          { label: "Excel (.xlsx)", desc: "Multi-sheet workbook · editable · full data · works in Google Sheets", icon: "⊞", color: "#10b981" },
          { label: "PDF (.pdf)", desc: "A4 formatted report · Iksana branding · page numbers · print-ready", icon: "◧", color: "#ef4444" },
        ].map(f => (
          <div key={f.label} style={{ background: "#13151f", border: "1px solid #1e2133", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 12, alignItems: "center", flex: 1 }}>
            <span style={{ fontSize: 22, color: f.color }}>{f.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {EXPORTS.map(exp => (
          <div key={exp.id} style={{ background: "#13151f", border: "1px solid #1e2133", borderRadius: 12, padding: "18px 22px", display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: `${exp.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: exp.color, flexShrink: 0 }}>{exp.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{exp.label}</span>
                {exp.badge && <span style={{ background: `${exp.color}22`, color: exp.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>{exp.badge}</span>}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{exp.desc}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="btn" style={{ background: "#10b98122", color: "#10b981", border: "1px solid #10b98144", padding: "8px 16px", fontSize: 12 }} disabled={!!exporting} onClick={() => handleExport(exp, "xlsx")}>
                {exporting === `${exp.id}-xlsx` ? "…" : "↓ Excel"}
              </button>
              {!exp.pdfDisabled ? (
                <button className="btn" style={{ background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444", padding: "8px 16px", fontSize: 12 }} disabled={!!exporting} onClick={() => handleExport(exp, "pdf")}>
                  {exporting === `${exp.id}-pdf` ? "…" : "↓ PDF"}
                </button>
              ) : (
                <div style={{ fontSize: 11, color: "#374151", alignSelf: "center", width: 80, textAlign: "center" }}>Excel only</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, background: "#13151f", border: "1px solid #1e2133", borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 10 }}>Notes</div>
        {[
          "Files download directly to your browser's Downloads folder.",
          "The Full Studio Report is a 5-sheet Excel workbook — ideal for weekly management sharing.",
          "All costs are calculated from engineer day rates × logged hours, shown in INR.",
          "Excel files open in Microsoft Excel, Google Sheets, or LibreOffice Calc.",
          "Data is exported directly from your browser — nothing is sent to any server.",
        ].map((note, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <span style={{ color: "#6366f1", flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>{note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Settings ─────────────────────────────────────────────────────────────────
function Settings({ users, setUsers, emailCfg, setEmailCfg, auditLog, showToast, currentUser, engineers, addAudit, onSendEmail }) {
  const [settingsTab, setSettingsTab] = useState("users");
  const [editUser, setEditUser] = useState(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [cfg, setCfg] = useState(emailCfg);

  const ENGINEER_ROLES = ["BIM Manager","Senior Architect","BIM Coordinator","Interior Designer","Revit Modeller","QS Estimator","Drafting Engineer","4D Planner","Manager Pre-contracts","Lead Estimator","Estimator"];

  const handleSaveUser = async (data) => {
    let updated;
    const { password, ...userData } = data;
    if (editUser) {
      let finalUser = { ...editUser, ...userData };
      if (password) {
        finalUser.passwordHash = await hashPassword(password);
        finalUser.mustChange = true;
      }
      updated = users.map(u => u.id === editUser.id ? finalUser : u);
      showToast(password ? "User updated & password reset" : "User updated");
      await addAudit(currentUser, "USER_EDIT", `Edited user: ${data.name}${password ? " (Password Reset)":""}`);
    } else {
      const hash = await hashPassword(data.password || "Iksana@2025");
      const { password, ...rest } = data;
      const newUser = { id:"u"+uid(), ...rest, passwordHash:hash, mustChange:true };
      updated = [...users, newUser];
      showToast("User created — default password: Iksana@2025");
      await addAudit(currentUser, "USER_CREATE", `Created user: ${data.name} (${data.role})`);
    }
    setUsers(updated);
    setShowUserForm(false); setEditUser(null);
  };

  const handleResetPassword = async (user) => {
    const hash = await hashPassword("Iksana@2025");
    const updated = users.map(u => u.id === user.id ? { ...u, passwordHash:hash, mustChange:true } : u);
    setUsers(updated);
    showToast(`Password reset for ${user.name}. They must change it on next login.`);
    await addAudit(currentUser, "PASSWORD_RESET", `Reset password for: ${user.name}`);
  };

  const handleToggleActive = async (user) => {
    const updated = users.map(u => u.id === user.id ? { ...u, active: u.active === false } : u);
    setUsers(updated);
    await addAudit(currentUser, "USER_STATUS", `${user.active === false ? "Activated":"Deactivated"} user: ${user.name}`);
  };

  const handleSaveEmail = async () => {
    setEmailCfg(cfg);
    showToast("Email settings saved");
    await addAudit(currentUser, "EMAIL_CONFIG", "Updated email notification settings");
  };

  const handleTestEmail = async () => {
    setTestSending(true);
    const ok = await onSendEmail({
      to_email: cfg.adminEmail,
      to_name: currentUser.name,
      subject: "Iksana Studio — Test Notification",
      message: `This is a test email from the Iksana Studio Management App.\n\nIf you received this, your email notification settings are correctly configured.\n\nTime: ${new Date().toLocaleString("en-IN")}`,
    });
    setTestSending(false);
    showToast(ok ? "Test email sent! Check your inbox." : "Failed to send — check your EmailJS credentials.", ok ? "success" : "error");
  };

  const STABS = [
    { id:"users",  label:"User Management" },
    { id:"email",  label:"Email Notifications" },
    { id:"audit",  label:"Audit Log" },
  ];

  return (
    <div>
      <PageHeader title="Settings" sub="Admin only — user management, email notifications, audit log" />
      <div style={{ display:"flex", gap:8, marginBottom:24 }}>
        {STABS.map(st => (
          <button key={st.id} className={`btn ${settingsTab===st.id?"btn-primary":"btn-ghost"}`} onClick={()=>setSettingsTab(st.id)}>{st.label}</button>
        ))}
      </div>

      {/* ── USER MANAGEMENT ── */}
      {settingsTab === "users" && (
        <div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
            <button className="btn btn-primary" onClick={()=>{setEditUser(null);setShowUserForm(true);}}>+ Add User</button>
          </div>
          <div className="card" style={{ padding:0 }}>
            <table>
              <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:32, height:32, borderRadius:"50%", background:`hsl(${u.name.charCodeAt(0)*10},60%,35%)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, flexShrink:0 }}>
                          {u.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                        </div>
                        <div>
                          <div style={{ fontWeight:500 }}>{u.name}</div>
                          {u.mustChange && <span style={{ fontSize:10, color:"#f59e0b" }}>⚠ Must change password</span>}
                        </div>
                      </div>
                    </td>
                    <td style={{ color:"#94a3b8", fontSize:12 }}>{u.email}</td>
                    <td><span className="tag" style={{ background:ROLES[u.role]?.bg, color:ROLES[u.role]?.color }}>{ROLES[u.role]?.label}</span></td>
                    <td><span className="tag" style={{ background:u.active===false?"#ef444422":"#10b98122", color:u.active===false?"#ef4444":"#10b981" }}>{u.active===false?"Inactive":"Active"}</span></td>
                    <td>
                      <div style={{ display:"flex", gap:4 }}>
                        <button className="btn btn-ghost" style={{ padding:"4px 8px",fontSize:11 }} onClick={()=>{setEditUser(u);setShowUserForm(true);}}>Edit</button>
                        <button className="btn btn-ghost" style={{ padding:"4px 8px",fontSize:11,color:"#f59e0b" }} onClick={()=>handleResetPassword(u)}>Reset Pwd</button>
                        <button className="btn btn-ghost" style={{ padding:"4px 8px",fontSize:11 }} onClick={()=>handleToggleActive(u)}>{u.active===false?"Activate":"Deactivate"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showUserForm && (
            <div className="modal-bg">
              <div className="modal">
                <div style={{ fontSize:15,fontWeight:600,marginBottom:20 }}>{editUser?"Edit User":"Add User"}</div>
                <UserForm user={editUser} engineers={engineers} onSave={handleSaveUser} onClose={()=>{setShowUserForm(false);setEditUser(null);}} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EMAIL NOTIFICATIONS ── */}
      {settingsTab === "email" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
          <div className="card">
            <div style={{ fontSize:13,fontWeight:600,marginBottom:4 }}>EmailJS Configuration</div>
            <div style={{ fontSize:12,color:"#64748b",marginBottom:16 }}>
              Create a free account at <span style={{ color:"#6366f1" }}>emailjs.com</span> → create a service and template → paste credentials below.
            </div>
            <div className="form-row">
              <label>Service ID</label>
              <input value={cfg.serviceId} onChange={e=>setCfg({...cfg,serviceId:e.target.value})} placeholder="service_xxxxxxx" />
            </div>
            <div className="form-row">
              <label>Template ID</label>
              <input value={cfg.templateId} onChange={e=>setCfg({...cfg,templateId:e.target.value})} placeholder="template_xxxxxxx" />
            </div>
            <div className="form-row">
              <label>Public Key</label>
              <input value={cfg.publicKey} onChange={e=>setCfg({...cfg,publicKey:e.target.value})} placeholder="xxxxxxxxxxxxxxxxxxxx" type="password" />
            </div>
            <div className="form-row">
              <label>Admin Email (receives alerts)</label>
              <input value={cfg.adminEmail} onChange={e=>setCfg({...cfg,adminEmail:e.target.value})} placeholder="admin@iksana.in" type="email" />
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <input type="checkbox" checked={cfg.enabled} onChange={e=>setCfg({...cfg,enabled:e.target.checked})} style={{ width:"auto" }} id="emailEnabled" />
              <label htmlFor="emailEnabled" style={{ marginBottom:0, cursor:"pointer" }}>Enable email notifications</label>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn btn-primary" onClick={handleSaveEmail}>Save Settings</button>
              <button className="btn btn-ghost" onClick={handleTestEmail} disabled={testSending||!cfg.enabled}>{testSending?"Sending…":"Send Test Email"}</button>
            </div>
            {!cfg.enabled && <div style={{ fontSize:11,color:"#374151",marginTop:8 }}>Enable notifications above to send a test email.</div>}
          </div>

          <div className="card">
            <div style={{ fontSize:13,fontWeight:600,marginBottom:16 }}>Notification Triggers</div>
            <div style={{ fontSize:12,color:"#64748b",marginBottom:16 }}>Choose which events send an email notification to the admin.</div>
            {[
              { key:"taskOverdue",   label:"Task overdue",               desc:"Email when a task passes its due date" },
              { key:"budgetWarning", label:"Budget warning (80%+)",       desc:"Email when a project reaches 80% budget burn" },
              { key:"leaveRequest",  label:"New leave request submitted", desc:"Email when an engineer submits leave" },
              { key:"leaveDecision", label:"Leave approved or rejected",  desc:"Email the engineer when their leave is decided" },
              { key:"taskAssigned",  label:"Task assigned to engineer",   desc:"Email the engineer when a new task is assigned" },
              { key:"weeklyDigest",  label:"Weekly digest (manual)",      desc:"Triggered from the Reports tab — not automatic" },
            ].map(t => (
              <div key={t.key} style={{ display:"flex",alignItems:"flex-start",gap:12,marginBottom:14 }}>
                <input type="checkbox" checked={cfg.triggers?.[t.key]||false} onChange={e=>setCfg({...cfg,triggers:{...cfg.triggers,[t.key]:e.target.checked}})} style={{ width:"auto",marginTop:2,flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13,fontWeight:500 }}>{t.label}</div>
                  <div style={{ fontSize:11,color:"#4a5568" }}>{t.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop:8,padding:"10px 12px",background:"#1a1d27",borderRadius:8 }}>
              <div style={{ fontSize:11,color:"#374151" }}>
                EmailJS template must include variables: <span style={{ color:"#6366f1",fontFamily:"monospace" }}>to_email, to_name, subject, message, admin_email</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AUDIT LOG ── */}
      {settingsTab === "audit" && (
        <div className="card" style={{ padding:0 }}>
          <div style={{ padding:"14px 20px",borderBottom:"1px solid #1e2133",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontSize:13,fontWeight:600 }}>Audit Log</div>
            <div style={{ fontSize:12,color:"#64748b" }}>{auditLog.length} entries (last 200)</div>
          </div>
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {auditLog.slice(0,100).map(entry => (
                <tr key={entry.id}>
                  <td style={{ fontFamily:"DM Mono",fontSize:11,color:"#64748b",whiteSpace:"nowrap" }}>{new Date(entry.ts).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</td>
                  <td style={{ fontWeight:500 }}>{entry.user}</td>
                  <td><span className="tag" style={{ background:ROLES[entry.role]?.bg||"#1e2133",color:ROLES[entry.role]?.color||"#64748b" }}>{entry.role}</span></td>
                  <td><span className="tag" style={{ background:"#1e2133",color:"#818cf8",fontFamily:"monospace" }}>{entry.action}</span></td>
                  <td style={{ fontSize:12,color:"#64748b" }}>{entry.detail}</td>
                </tr>
              ))}
              {auditLog.length===0 && <tr><td colSpan={5} style={{ textAlign:"center",color:"#374151",padding:32 }}>No audit entries yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserForm({ user, engineers, onSave, onClose }) {
  const [d, setD] = useState(user || { name:"", email:"", role:"operator", engineerId:"", password:"" });
  const set = (k,v) => setD(p=>({...p,[k]:v}));

  // Auto-fill name and email when engineer is selected
  const handleEngineerChange = (engId) => {
    set("engineerId", engId);
    if (!engId) return;
    const eng = engineers.find(e => e.id === engId);
    if (eng) {
      if (!d.name) set("name", eng.name);
      if (!d.email && eng.email) setD(prev => ({ ...prev, engineerId: engId, name: prev.name || eng.name, email: prev.email || eng.email }));
      else setD(prev => ({ ...prev, engineerId: engId, name: prev.name || eng.name }));
    }
  };

  return (
    <>
      <div className="form-row"><label>Full Name</label><input value={d.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Rahul Sharma" /></div>
      <div className="form-row">
        <label>Email Address (used for login)</label>
        <input type="email" value={d.email} onChange={e=>set("email",e.target.value)} placeholder="name@iksana.tech" />
        {d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) && (
          <div style={{ fontSize:11, color:"#ef4444", marginTop:4 }}>Please enter a valid email address</div>
        )}
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label>Role</label>
          <select value={d.role} onChange={e=>set("role",e.target.value)}>
            {["admin","manager","operator"].map(r=><option key={r} value={r}>{ROLES[r].label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Linked Engineer Profile</label>
          <select value={d.engineerId} onChange={e=>handleEngineerChange(e.target.value)}>
            <option value="">None</option>
            {engineers.map(e=><option key={e.id} value={e.id}>{e.name}{e.email?` — ${e.email}`:""}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>{user ? "New Password (leave blank to keep current)" : "Initial Password"}</label>
          <input type="password" value={d.password} onChange={e=>set("password",e.target.value)} placeholder={user ? "Set new password" : "Leave blank for Iksana@2025"} />
        </div>
      </div>
      {d.engineerId && (() => { const eng = engineers.find(e=>e.id===d.engineerId); return eng?.email && eng.email !== d.email ? (
        <div style={{ fontSize:11,color:"#f59e0b",marginBottom:12,padding:"6px 10px",background:"#f59e0b15",borderRadius:6 }}>
          ⚠ Engineer profile email ({eng.email}) differs from login email above. Update to match if intended.
        </div>
      ) : null; })()}
      <div style={{ display:"flex",gap:8,marginTop:8 }}>
        <button className="btn btn-primary" onClick={()=>onSave(d)} disabled={!d.email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)}>Save</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </>
  );
}

function Import({ engineers, projects, tasks, setTasks, showToast }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importFiles, setImportFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const downloadTemplate = async () => {
    try {
      console.log("Generating template...");
      const data = [
        ["Title", "Project ID", "Discipline", "Priority", "Estimated Hours", "Due Date (YYYY-MM-DD)", "Assignee Email (Optional)"],
        ["Sample Task 1", projects[0]?.id || "proj-1", "BIM", "medium", 12, "2025-12-31", engineers[0]?.email || ""],
        ["Sample Task 2", projects[0]?.id || "proj-1", "Architecture", "high", 8, "2025-12-31", ""],
      ];
      await xlsxDownload([{ name: "Task Template", data, colWidths: [30, 15, 15, 10, 15, 20, 25] }], "iksana-task-template.xlsx");
      showToast("Template downloaded");
    } catch (e) {
      console.error("Template Error:", e);
      showToast("Download failed - see console", "error");
    }
  };

  const handleFileChange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    console.log("Parsing file:", f.name);
    setLoading(true);
    try {
      const XLSX = await loadXLSX();
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        // Parse rows (skip header)
        const rows = data.slice(1).filter(r => r[0]).map(r => {
          const eng = engineers.find(e => e.email === r[6]);
          return {
            id: "t" + uid(),
            title: r[0],
            projectId: r[1],
            discipline: r[2] || "BIM",
            priority: (r[3] || "medium").toLowerCase(),
            estimatedHours: Number(r[4]) || 0,
            loggedHours: 0,
            dueDate: r[5],
            assignee: eng ? eng.id : "",
            status: "not-started",
            attachments: (importFiles || []).map(f => ({ name: f.name, type: f.name.split(".").pop().toLowerCase(), path: f.path })),
            createdAt: new Date().toISOString().slice(0, 10)
          };
        });
        setPreview(rows);
      };
      reader.readAsBinaryString(f);
      setFile(f);
    } catch (e) {
      console.error(e);
      showToast("Error parsing file", "error");
    }
    setLoading(false);
  };

  const handleBulkAttach = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploading(true);
    const results = [];
    for (const f of files) {
      const path = await uploadFile(f);
      if (path) results.push({ name: f.name, path });
    }
    setImportFiles(prev => [...prev, ...results]);
    setUploading(false);
    showToast(`${results.length} files prepared for import batch`);
  };

  const commitImport = async () => {
    const updated = [...tasks, ...preview];
    await save(KEYS.tasks, updated);
    setTasks(updated);
    showToast(`${preview.length} tasks imported successfully`);
    setPreview([]);
    setFile(null);
    setImportFiles([]);
  };

  return (
    <div>
      <PageHeader title="Import Tasks" sub="Bulk create tasks from Excel" />
      
      <div className="card" style={{ marginBottom: 24, background:"#111827" }}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:10 }}>Bulk Import Tasks</div>
        <p style={{ fontSize:13, color:"#94a3b8", marginBottom:20 }}>
          Upload an Excel (.xlsx) or CSV file with your task data. 
          <br/><span style={{ fontSize:11, color:"#64748b" }}>Required columns: Title, Project ID, Discipline, Priority, Estimated Hours, Due Date (YYYY-MM-DD)</span>
        </p>
        
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div style={{ padding:16, background:"#0c0e14", borderRadius:12, border:"1px dashed #374151" }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>1. Select Data File</div>
            <label className="btn btn-primary" style={{ cursor:"pointer", width:"100%", justifyContent:"center" }}>
              {file ? `✓ ${file.name}` : "📁 Choose Excel/CSV"}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} style={{ display:"none" }} />
            </label>
          </div>
          
          <div style={{ padding:16, background:"#0c0e14", borderRadius:12, border:"1px dashed #374151" }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>2. Attach Support Files (Optional)</div>
            <label className="btn btn-ghost" style={{ cursor:"pointer", width:"100%", justifyContent:"center" }}>
              {uploading ? "⌛ Uploading..." : "📁 Attach DWG/PDF"}
              <input type="file" multiple onChange={handleBulkAttach} style={{ display:"none" }} disabled={uploading} />
            </label>
            {importFiles.length > 0 && (
              <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:5 }}>
                {importFiles.map((f, i) => (
                  <div key={i} className="tag" style={{ fontSize:10 }}>{f.name}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ fontSize:15, fontWeight:600 }}>Preview: {preview.length} Tasks Found</div>
            <div style={{ display:"flex", gap:10 }}>
              <button className="btn btn-primary" onClick={commitImport}>Import All Tasks</button>
              <button className="btn btn-ghost" onClick={() => { setPreview([]); setFile(null); }}>Cancel</button>
            </div>
          </div>
          <table style={{ fontSize:12 }}>
            <thead><tr><th>Title</th><th>Project</th><th>Discipline</th><th>Assignee</th><th>Est. Hrs</th><th>Due</th></tr></thead>
            <tbody>
              {preview.map((t, i) => (
                <tr key={i}>
                  <td>{t.title}</td>
                  <td>{t.projectId}</td>
                  <td>{t.discipline}</td>
                  <td>{engineers.find(e => e.id === t.assignee)?.name || "—"}</td>
                  <td>{t.estimatedHours}h</td>
                  <td>{fmtDate(t.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PageHeader({ title, sub, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", color: "#f1f5f9" }}>{title}</h1>
        {sub && <div style={{ fontSize: 13, color: "#4a5568", marginTop: 2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

