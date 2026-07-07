import React, { useState, useEffect, useRef } from 'react';
import {
  Package, 
  UploadCloud, 
  TrendingUp, 
  ShieldCheck, 
  FileCode, 
  User, 
  Activity, 
  MapPin, 
  Layers, 
  Calendar, 
  Check, 
  X, 
  Search, 
  AlertCircle, 
  Crown, 
  Medal, 
  Info,
  Loader2,
  Trash2,
  LockKeyhole,
  LogOut,
  Settings
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { dbService } from './dbService';
import type { Employee, Submission } from './dbService';

// Fallback image helper
const DEFAULT_PREVIEW = 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600';
const ADMIN_EMAIL = 'admin@pea.co.th';
const ADMIN_PASSWORD = 'Pea111*';

export default function App() {
  const [activeTab, setActiveTab] = useState<'employee-form' | 'company-dashboard' | 'admin-portal' | 'system-spec'>('company-dashboard');
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const [empIdInput, setEmpIdInput] = useState('');
  const [activityType, setActivityType] = useState('วิ่ง');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [confirmedKcal, setConfirmedKcal] = useState('');
  const [imageHash, setImageHash] = useState('');

  // Search State
  const [searchId, setSearchId] = useState('');

  // Toast State
  const [toast, setToast] = useState<{ title: string; desc: string; type: 'success' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const empData = await dbService.getEmployees();
        const subData = await dbService.getSubmissions();
        setEmployees(empData);
        setSubmissions(subData);
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const showToast = (title: string, desc: string, type: 'success' | 'error' = 'success') => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ title, desc, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Switch tabs
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminEmail.trim().toLowerCase() === ADMIN_EMAIL && adminPassword === ADMIN_PASSWORD) {
      setIsAdminAuthenticated(true);
      setAdminLoginError('');
      setAdminPassword('');
      showToast('เข้าสู่หลังบ้านสำเร็จ', 'สามารถตรวจสอบและอนุมัติรายการกิจกรรมได้แล้ว', 'success');
      return;
    }

    setAdminLoginError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setAdminEmail('');
    setAdminPassword('');
    setActiveTab('company-dashboard');
    showToast('ออกจากหลังบ้านแล้ว', 'กลับสู่หน้าผู้ใช้งานทั่วไป', 'success');
  };

  // Hashing Image logic for anti-cheat
  const calculateHash = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Handle proof image upload and duplicate-image hashing.
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImagePreview(URL.createObjectURL(file));
    setImageLoading(true);
    setConfirmedKcal('');

    try {
      const hash = await calculateHash(file);
      setImageHash(hash);

      const isDuplicate = submissions.some(s => s.imageHash === hash);
      if (isDuplicate) {
        showToast('ตรวจพบรูปภาพซ้ำซ้อน', 'รูปภาพหลักฐานนี้เคยถูกอัปโหลดในระบบแล้ว กรุณาอัปโหลดรูปภาพใหม่เพื่อป้องกันการทุจริต', 'error');
        resetFormImage();
        setImageLoading(false);
        return;
      }

      setImageLoading(false);
    } catch (err) {
      console.error('Image upload error:', err);
      setImageLoading(false);
      showToast('เกิดข้อผิดพลาดในการเตรียมรูปภาพ', 'กรุณาลองใหม่อีกครั้ง', 'error');
    }
  };

  const resetFormImage = () => {
    setImagePreview(null);
    setConfirmedKcal('');
    setImageHash('');
  };

  // Form submission handler
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = empIdInput.trim().toUpperCase();

    // 1. Check if employee is registered
    const employee = employees[cleanId];
    if (!employee) {
      showToast('ไม่พบรหัสพนักงาน', 'กรุณากรอกรหัส EMP1001 ถึง EMP1005 ในแบบจำลอง', 'error');
      return;
    }

    // 2. Enforce Daily Limit (1 submission per employee per day)
    const todayStr = new Date().toISOString().split('T')[0];
    const alreadySubmitted = submissions.some(
      s => s.empId === cleanId && s.scannedDate === todayStr && s.status !== 'rejected'
    );
    if (alreadySubmitted) {
      showToast('ส่งข้อมูลซ้ำในวันเดียวกัน', `พนักงาน ${employee.name} ได้บันทึกผลงานประจำวันนี้ไปแล้ว (จำกัด 1 สิทธิ์/วัน)`, 'error');
      return;
    }

    const confirmedKcalValue = Number(confirmedKcal);
    if (!Number.isFinite(confirmedKcalValue) || confirmedKcalValue < 1 || confirmedKcalValue > 5000) {
      showToast('กรุณายืนยันค่าแคลอรี่', 'ตรวจสอบตัวเลขจากภาพและกรอกค่าแคลอรี่ที่ถูกต้องก่อนส่งผลงาน', 'error');
      return;
    }

    // 3. Prevent duplicate hash submission
    const duplicateCheck = submissions.some(s => s.imageHash === imageHash);
    if (duplicateCheck) {
      showToast('ตรวจพบรูปภาพซ้ำซ้อน', 'ระบบห้ามกรอกข้อมูลจากหลักฐานภาพเดิมเพื่อความปลอดภัย', 'error');
      return;
    }

    // Prepare submission object
    const newSubData = {
      empId: cleanId,
      name: employee.name,
      department: employee.department,
      division: employee.division,
      activityType,
      kcal: Math.round(confirmedKcalValue),
      imageUrl: imagePreview || DEFAULT_PREVIEW,
      scannedDate: todayStr,
      status: 'pending' as const,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      imageHash: imageHash || 'local-' + Math.random().toString(36).substr(2, 9)
    };

    try {
      const addedSub = await dbService.createSubmission(newSubData);
      setSubmissions(prev => [...prev, addedSub]);
      
      // Reset form fields
      setEmpIdInput('');
      resetFormImage();
      
      // Play celebratory sound or confetti
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#10b981', '#14b8a6', '#3b82f6']
      });

      showToast('ส่งผลงานสำเร็จ!', 'ข้อมูลบันทึกแคลอรี่รอผู้ดูแลระบบอนุมัติขึ้นกระดานคะแนน', 'success');
    } catch (err) {
      console.error(err);
      showToast('บันทึกไม่สำเร็จ', 'ระบบขัดข้องกรุณาลองใหม่อีกครั้ง', 'error');
    }
  };

  // Admin Actions
  const handleApprove = async (id: number) => {
    try {
      const success = await dbService.updateStatus(id, 'approved');
      if (success) {
        setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'approved' } : s));
        
        confetti({
          particleCount: 50,
          spread: 45,
          colors: ['#10b981', '#34d399']
        });
        
        showToast('อนุมัติผลงานสำเร็จ', 'สถิติขึ้นกระดานจัดอันดับเรียบร้อยแล้ว', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('ไม่สามารถอนุมัติได้', 'เกิดข้อผิดพลาดในการปรับปรุงข้อมูล', 'error');
    }
  };

  const handleReject = async (id: number) => {
    try {
      const success = await dbService.updateStatus(id, 'rejected');
      if (success) {
        setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' } : s));
        showToast('ปฏิเสธรายการแล้ว', 'ปฏิเสธคำขอการเผาผลาญเรียบร้อยแล้ว', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('ปฏิเสธรายการไม่สำเร็จ', 'ขัดข้องในระบบฐานข้อมูล', 'error');
    }
  };

  const handleApproveAll = async () => {
    const pendingCount = submissions.filter(s => s.status === 'pending').length;
    if (pendingCount === 0) {
      showToast('ไม่มีรายการค้างอนุมัติ', 'ไม่พบประวัติรอคิวพิจารณาเพิ่มเติม', 'error');
      return;
    }

    try {
      const approvedCount = await dbService.approveAll();
      setSubmissions(prev => prev.map(s => s.status === 'pending' ? { ...s, status: 'approved' } : s));

      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      showToast('อนุมัติรายการทั้งหมดแล้ว', `ทำการอนุมัติสถิติจำนวน ${approvedCount} คำขอเรียบร้อยแล้ว`, 'success');
    } catch (err) {
      console.error(err);
      showToast('ขัดข้องในการอนุมัติคิว', 'กรุณาลองใหม่อีกครั้ง', 'error');
    }
  };

  // Spec File Downloader
  const handleDownloadSpec = () => {
    const markdownPayload = `# Specification: FitVerify AI Tracker (ระบบบันทึกสถิติการออกกำลังกายพนักงาน)

ระบบเว็บแอปพลิเคชันสถิติการออกกำลังกายภายในองค์กร รองรับการอัปโหลดภาพถ่ายหลักฐานและให้พนักงานกรอกค่า kcal จากภาพด้วยตนเอง พร้อมระบบป้องกันการส่งรูปซ้ำ จัดอันดับตามโครงสร้าง ฝ่าย (Department), กอง (Division) และแสดงผลในรูปแบบ Interactive & Responsive Dashboard

---

## 1. Tech Stack & Infrastructure
- **Frontend & API Hosting:** Vercel (โฮสต์เว็บแอปพลิเคชัน และ Serverless Functions)
- **Version Control & CI/CD:** GitHub (เชื่อมต่อกับ Vercel เพื่อ Deploy อัตโนมัติ)
- **Database, Auth & Storage:** Supabase (PostgreSQL Database + Storage สำหรับเก็บรูปหลักฐาน)
- **Manual Verification:** พนักงานกรอกค่า kcal จากภาพหลักฐานด้วยตนเองและรอผู้ดูแลระบบอนุมัติ

---

## 2. โครงสร้างฐานข้อมูล (Supabase Database Schema)

### ตารางที่ 1: \`employees\`
\`\`\`sql
CREATE TABLE employees (
    emp_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL,
    division VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
\`\`\`

### ตารางที่ 2: \`submissions\`
\`\`\`sql
CREATE TABLE submissions (
    id BIGSERIAL PRIMARY KEY,
    emp_id VARCHAR(50) REFERENCES employees(emp_id),
    activity_type VARCHAR(100) NOT NULL,
    kcal INT NOT NULL,
    image_url TEXT NOT NULL,
    image_hash VARCHAR(64) NOT NULL,
    scanned_date DATE NOT NULL,
    submission_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
\`\`\`

---

## 3. เงื่อนไขและกฎของระบบ (Core Business Logic)
1. **การจำกัดสิทธิ์ (Daily Limit Rule):** พนักงาน 1 คน สามารถส่งได้ 1 ครั้งต่อ 1 วันเท่านั้น
2. **การป้องกันทุจริตด้วยภาพถ่าย (Anti-Cheat Mechanism):** ทำ Image Hashing ป้องกันรูปภาพเวียนเทียนส่งซ้ำ
3. **กลไกการคำนวณกลุ่ม (Aggregation Logic):** บอร์ดแสดงคะแนนเฉพาะสถานะ \`approved\` สรุปตามโครงสร้างฝ่ายและกองงานย่อย
`;

    const blob = new Blob([markdownPayload], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'specification.md');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('ดาวน์โหลดข้อมูลสำเร็จ', 'ระบบบันทึกไฟล์ specification.md ลงคอมพิวเตอร์ของคุณเรียบร้อยแล้ว', 'success');
  };

  // Leaderboard Aggregations (Only approved submissions)
  const approvedSubmissions = submissions.filter(s => s.status === 'approved');

  // Stats
  const totalKcal = approvedSubmissions.reduce((sum, s) => sum + s.kcal, 0);
  const activeUserCount = new Set(approvedSubmissions.map(s => s.empId)).size;

  // Weekly top performer
  const userTotals: Record<string, number> = {};
  approvedSubmissions.forEach(s => {
    userTotals[s.empId] = (userTotals[s.empId] || 0) + s.kcal;
  });
  
  let topEmpId = '';
  let topKcal = 0;
  Object.keys(userTotals).forEach(id => {
    if (userTotals[id] > topKcal) {
      topKcal = userTotals[id];
      topEmpId = id;
    }
  });

  const topPerformer = topEmpId ? employees[topEmpId] : null;

  // Department rankings
  const deptTotals: Record<string, number> = {};
  approvedSubmissions.forEach(s => {
    if (s.department) {
      deptTotals[s.department] = (deptTotals[s.department] || 0) + s.kcal;
    }
  });
  const sortedDepts = Object.keys(deptTotals)
    .map(name => ({ name, kcal: deptTotals[name] }))
    .sort((a, b) => b.kcal - a.kcal);

  // Division rankings
  const divTotals: Record<string, number> = {};
  approvedSubmissions.forEach(s => {
    if (s.division) {
      divTotals[s.division] = (divTotals[s.division] || 0) + s.kcal;
    }
  });
  const sortedDivs = Object.keys(divTotals)
    .map(name => ({ name, kcal: divTotals[name] }))
    .sort((a, b) => b.kcal - a.kcal);

  // Pending queue
  const pendingQueue = submissions.filter(s => s.status === 'pending');

  // Search Results
  const cleanSearchId = searchId.trim().toUpperCase();
  const searchEmployee = employees[cleanSearchId];
  const searchSubmissions = cleanSearchId ? submissions.filter(s => s.empId === cleanSearchId) : [];
  const searchApprovedKcal = searchSubmissions
    .filter(s => s.status === 'approved')
    .reduce((sum, s) => sum + s.kcal, 0);
  const confirmedKcalValue = Number(confirmedKcal);
  const hasValidConfirmedKcal = Number.isFinite(confirmedKcalValue) && confirmedKcalValue >= 1 && confirmedKcalValue <= 5000;
  const canSubmitForm = hasValidConfirmedKcal && !!imagePreview && !!empIdInput.trim() && !!employees[empIdInput.trim().toUpperCase()];

  return (
    <div className="bg-white text-[#72246C] min-h-screen flex flex-col justify-between">
      
      {/* HEADER SECTION */}
      <header className="bg-white/95 border-b border-[#C69214]/30 py-4 px-6 sticky top-0 z-50 flex flex-wrap justify-between items-center gap-4 shadow-lg shadow-[#72246C]/10 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-[#72246C]/10 via-white to-[#C69214]/10 border border-[#C69214]/35 shadow-lg shadow-[#72246C]/10 px-4 py-2">
            <img src="/pea-move.png" alt="PEA Titan Move" className="h-24 md:h-28 w-auto object-contain" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#72246C] m-0 leading-none">
              PEA Titan Move
            </h1>
            <p className="text-xs text-[#C69214] mt-1 mb-0 font-semibold">
              ขยับวันนี้ เพื่อสุขภาพที่ดีของเรา
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <nav className="flex flex-wrap bg-white p-1.5 rounded-xl border border-[#C69214]/30 gap-1 shadow-sm">
            <button 
              onClick={() => handleTabChange('employee-form')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all duration-300 ${
                activeTab === 'employee-form' 
                  ? 'bg-gradient-to-r from-[#72246C] to-[#C69214] text-white shadow-md' 
                  : 'text-[#72246C] hover:bg-[#72246C]/5'
              }`}
            >
              <UploadCloud className="h-4 w-4" />
              <span>ส่งข้อมูลกิจกรรม</span>
            </button>
            
            <button 
              onClick={() => handleTabChange('company-dashboard')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all duration-300 ${
                activeTab === 'company-dashboard' 
                  ? 'bg-gradient-to-r from-[#72246C] to-[#C69214] text-white shadow-md' 
                  : 'text-[#72246C] hover:bg-[#72246C]/5'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
              <span>แดชบอร์ดสุขภาพองค์กร</span>
            </button>
          </nav>

          <button
            type="button"
            title="หลังบ้าน"
            aria-label="เข้าสู่หลังบ้าน"
            onClick={() => handleTabChange('admin-portal')}
            className={`relative w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
              activeTab === 'admin-portal'
                ? 'border-[#72246C] bg-[#72246C] text-white'
                : 'border-[#C69214]/30 bg-white text-[#72246C]/55 hover:text-[#72246C] hover:border-[#72246C]/45'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* CORE CONTENT */}
      <main className="flex-grow container mx-auto px-4 py-8 max-w-7xl">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-10 w-10 text-[#C69214] animate-spin" />
            <p className="text-sm text-[#72246C]/65">กำลังโหลดข้อมูลระบบ...</p>
          </div>
        ) : (
          <>
            {/* ALERT BOX FOR MOCK STATUS */}
            {dbService.isMock && (
              <div className="mb-6 bg-[#C69214]/10 border border-[#C69214]/25 rounded-2xl p-4 flex items-center gap-3 text-xs text-[#72246C]">
                <AlertCircle className="h-5 w-5 text-[#C69214] shrink-0" />
                <div>
                  <span className="font-bold">โหมดจำลองฐานข้อมูลในเครื่อง (LocalStorage Mode) กำลังทำงาน:</span> ข้อมูลทั้งหมดจะบันทึกอยู่ในเว็บเบราว์เซอร์นี้แบบออฟไลน์ คุณสามารถแก้ไขและทดสอบได้ฟรีโดยไม่มีค่าใช้จ่าย และหากพร้อมเชื่อมต่อฐานข้อมูล Supabase สามารถนำ URL/Key ไปใส่ในตัวแปรสภาพแวดล้อมได้ทันที
                </div>
              </div>
            )}

            {/* TAB 1: EMPLOYEE SUBMISSION FORM */}
            {activeTab === 'employee-form' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-gradient-to-br from-white via-white to-[#C69214]/10 border border-[#C69214]/20 p-6 rounded-2xl shadow-sm">
                    <h2 className="text-lg font-bold text-[#C69214] mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" /> 
                      ระบบลงทะเบียนผลรายวัน
                    </h2>
                    <p className="text-xs text-[#72246C]/80 leading-relaxed">
                      กรอกรหัสพนักงาน เลือกกิจกรรม แนบภาพหลักฐาน แล้วกรอกค่า kcal จากภาพด้วยตนเอง ระบบจะตรวจรูปซ้ำด้วย Image Hash และส่งรายการให้ผู้ดูแลอนุมัติก่อนขึ้นคะแนน
                    </p>
                  </div>
                </div>

                <div className="lg:col-span-8 bg-white border border-[#C69214]/20 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#C69214] to-[#72246C]"></div>
                  <h2 className="text-2xl font-bold text-[#72246C] mb-6 flex items-center gap-3">
                    <User className="h-6 w-6 text-[#C69214]" />
                    ส่งผลการเผาผลาญพลังงานประจำวัน
                  </h2>

                  <form onSubmit={handleFormSubmit} className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-[#72246C]/80 mb-2">
                        เลขรหัสพนักงาน (กรอกเพื่อทดสอบ: EMP1001 ถึง EMP1005)
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#72246C]/45">
                          <User className="h-5 w-5" />
                        </div>
                        <input 
                          type="text" 
                          required 
                          value={empIdInput}
                          onChange={(e) => setEmpIdInput(e.target.value)}
                          placeholder="เช่น EMP1001, EMP1002..." 
                          className="w-full bg-white border border-[#C69214]/20 focus:border-[#C69214] focus:ring-1 focus:ring-[#C69214] rounded-xl py-3 pl-11 pr-4 text-[#72246C] placeholder-[#72246C]/35 transition-all focus:outline-none"
                        />
                      </div>
                      {empIdInput.trim() && employees[empIdInput.trim().toUpperCase()] && (
                        <p className="mt-2 text-xs text-[#C69214] flex items-center gap-1">
                          <Check className="h-3 h-3" />
                          พนักงาน: {employees[empIdInput.trim().toUpperCase()].name} | ฝ่าย: {employees[empIdInput.trim().toUpperCase()].department} ({employees[empIdInput.trim().toUpperCase()].division})
                        </p>
                      )}
                      {empIdInput.trim() && !employees[empIdInput.trim().toUpperCase()] && (
                        <p className="mt-2 text-xs text-rose-400 flex items-center gap-1">
                          <X className="h-3 h-3" />
                          ไม่พบรหัสพนักงานนี้ในระบบแบบจำลอง
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[#72246C]/80 mb-3">กิจกรรมที่ออกกำลังกาย</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {[
                          { val: 'วิ่ง', label: 'วิ่ง' },
                          { val: 'เดิน', label: 'เดิน' },
                          { val: 'ปั่นจักรยาน', label: 'ปั่นจักรยาน' },
                          { val: 'ยิม / ฟิตเนส', label: 'ยิม / ฟิตเนส' },
                          { val: 'ปิงปอง', label: 'ปิงปอง' },
                          { val: 'แบดมินตัน', label: 'แบดมินตัน' },
                          { val: 'เทนนิส', label: 'เทนนิส' },
                          { val: 'กอล์ฟ', label: 'กอล์ฟ' },
                          { val: 'เปตอง', label: 'เปตอง' },
                          { val: 'บาสเกตบอล', label: 'บาสเกตบอล' },
                          { val: 'ฟุตบอล / ฟุตซอล', label: 'ฟุตบอล / ฟุตซอล' },
                          { val: 'กีฬาอื่น ๆ', label: 'กีฬาอื่น ๆ' }
                        ].map(act => (
                          <button
                            key={act.val}
                            type="button"
                            onClick={() => setActivityType(act.val)}
                            className={`px-3 py-2 rounded-xl flex items-center justify-center text-center gap-1.5 cursor-pointer transition-all border min-h-11 ${
                              activityType === act.val 
                                ? 'border-[#72246C]/30 bg-gradient-to-r from-[#72246C] to-[#C69214] text-white shadow-sm' 
                                : 'border-[#C69214]/25 bg-white text-[#72246C] hover:bg-[#72246C]/5'
                            }`}
                          >
                            <Activity className="h-3.5 w-3.5 shrink-0" />
                            <span className="text-[11px] font-semibold leading-tight">{act.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[#72246C]/80 mb-2">อัปโหลดภาพถ่ายหลักฐานบันทึกผล</label>
                      <div className="border-2 border-dashed border-[#C69214]/20 hover:border-[#C69214]/40 bg-white rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all relative overflow-hidden group">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="absolute inset-0 opacity-0 cursor-pointer z-20" 
                          onChange={handleImageChange}
                        />
                        {!imagePreview ? (
                          <div className="space-y-3 py-4">
                            <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center mx-auto text-[#C69214] group-hover:scale-110 transition-transform">
                              <UploadCloud className="h-6 w-6" />
                            </div>
                            <p className="text-sm text-[#72246C]/80">
                              <span className="text-[#C69214] font-semibold">คลิกอัปโหลดรูปภาพ</span> หรือลากวางไฟล์ที่นี่
                            </p>
                            <p className="text-xs text-[#72246C]/45 font-mono">JPG, PNG หรือภาพถ่ายจากนาฬิกาสมาร์ทวอทช์</p>
                          </div>
                        ) : (
                          <div className="w-full max-w-xs rounded-xl overflow-hidden border border-[#C69214]/15 bg-white/90 p-2 relative z-30 flex justify-center items-center mx-auto">
                            <img 
                              src={imagePreview} 
                              className="max-h-96 w-auto max-w-full rounded-lg object-contain" 
                              alt="Workout proof preview" 
                            />
                            <button 
                              type="button" 
                              onClick={(e) => { e.stopPropagation(); resetFormImage(); }} 
                              className="absolute top-4 right-4 bg-white/90 hover:bg-white text-rose-400 hover:text-rose-300 w-8 h-8 rounded-full flex items-center justify-center border border-[#C69214]/20 shadow-md transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {imageLoading && (
                      <div className="bg-white border border-[#C69214]/20 p-6 rounded-2xl flex items-center justify-center gap-3">
                        <Loader2 className="h-5 w-5 text-[#C69214] animate-spin" />
                        <span className="text-sm font-semibold text-[#C69214]">กำลังตรวจสอบไฟล์หลักฐาน...</span>
                      </div>
                    )}

                    {imagePreview && !imageLoading && (
                      <div className="bg-white border border-[#C69214]/20 p-5 rounded-xl space-y-4">
                        <h3 className="text-xs font-bold text-[#C69214] uppercase tracking-wider flex items-center gap-1.5">
                          <Package className="h-4 w-4" />
                          ตรวจสอบและยืนยันข้อมูลจากภาพถ่าย
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white p-4 rounded-lg border border-[#C69214]/20">
                            <label className="block text-xs text-[#72246C]/65 mb-1">จำนวนพลังงานที่จะบันทึกจริง</label>
                            <div className="flex items-baseline gap-2">
                              <input 
                                type="number" 
                                required 
                                min="1"
                                max="5000"
                                value={confirmedKcal}
                                onChange={(e) => setConfirmedKcal(e.target.value)}
                                placeholder="กรอกเลข kcal"
                                className="bg-transparent text-2xl font-bold text-[#C69214] focus:outline-none w-32 border-b border-dashed border-[#C69214]/30"
                              />
                              <span className="text-sm text-[#72246C]/65 font-mono">kcal</span>
                            </div>
                            <p className="mt-2 text-[11px] text-[#72246C]/45">
                              กรุณากรอกค่าจากภาพหลักฐานด้วยตนเองก่อนส่งข้อมูล
                            </p>
                            {!hasValidConfirmedKcal && (
                              <p className="mt-2 text-[11px] text-rose-400">กรุณากรอกตัวเลข 1-5000 kcal ก่อนส่ง</p>
                            )}
                          </div>
                          <div className="bg-white p-4 rounded-lg border border-[#C69214]/20 flex flex-col justify-between">
                            <div>
                              <span className="block text-xs text-[#72246C]/65 mb-1">หลักฐานภาพถ่าย</span>
                              <span className="font-bold text-sm text-[#C69214]">แนบรูปแล้ว กรุณาตรวจสอบข้อมูลก่อนส่ง</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-4 flex justify-end gap-4">
                      <button 
                        type="submit" 
                        disabled={!canSubmitForm} 
                        className={`px-8 py-3 rounded-xl font-bold text-sm transition-all duration-300 shadow-lg ${
                          canSubmitForm
                            ? 'bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] shadow-[#C69214]/10 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0'
                            : 'bg-[#F3E9F1] text-[#72246C]/45 border border-[#72246C]/10 cursor-not-allowed shadow-none'
                        }`}
                      >
                        ยืนยันข้อมูลส่งผลงาน
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* TAB 2: INTERACTIVE DASHBOARD */}
            {activeTab === 'company-dashboard' && (
              <div className="space-y-8 animate-fadeIn">
                {/* TOP AGGREGATES CARDS */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                  <div className="bg-gradient-to-br from-[#C69214]/20 via-white to-white border border-[#C69214]/30 rounded-2xl p-6 relative overflow-hidden lg:col-span-2 group">
                    <div className="absolute -right-4 -bottom-4 text-[#C69214]/5 text-9xl group-hover:scale-110 transition-transform">
                      <Crown />
                    </div>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="bg-[#C69214]/10 text-[#C69214] border border-[#C69214]/20 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 w-fit">
                          <Crown className="h-3.5 w-3.5" />
                          แชมป์แคลอรี่สะสมสูงสุดสัปดาห์นี้
                        </span>
                        <h3 className="text-2xl font-extrabold text-[#72246C] mt-4 tracking-tight">
                          {topPerformer ? topPerformer.name : 'กำลังรอผลอนุมัติ'}
                        </h3>
                        <p className="text-xs text-[#72246C]/65 mt-1">
                          สังกัด: {topPerformer ? `${topPerformer.department} (${topPerformer.division})` : '-'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-[#72246C]/45 block font-mono">ยอดเผาผลาญสะสม</span>
                        <span className="text-3xl font-black text-[#C69214] font-mono">
                          {topKcal.toLocaleString()}
                        </span>
                        <span className="text-xs text-[#C69214] block font-semibold">kcal</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6 relative overflow-hidden">
                    <p className="text-sm text-[#72246C]/65 font-medium">รวมพลังงานองค์กรที่เผาผลาญ</p>
                    <h3 className="text-3xl font-extrabold text-[#C69214] mt-2 font-mono">
                      {totalKcal.toLocaleString()} kcal
                    </h3>
                    <span className="text-xs text-[#72246C]/45">นับเฉพาะรายงานที่ได้รับการอนุมัติ</span>
                  </div>

                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6 relative overflow-hidden">
                    <p className="text-sm text-[#72246C]/65 font-medium">บุคลากรที่เข้าร่วมสุขภาพ</p>
                    <h3 className="text-3xl font-extrabold text-[#C69214] mt-2 font-mono">
                      {activeUserCount} คน
                    </h3>
                    <span className="text-xs text-[#72246C]/45">คนที่มีคะแนนอนุมัติแล้ว</span>
                  </div>
                </div>

                {/* LEADERS CHART BOARD */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Department ranking */}
                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-[#72246C] flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-[#C69214]" />
                        อันดับตาม "ฝ่าย" (Department Leaderboard)
                      </h3>
                      <span className="text-[10px] bg-white text-[#72246C]/65 px-2 py-0.5 rounded font-mono">Kcal Rank</span>
                    </div>
                    
                    <div className="space-y-5 mt-6">
                      {sortedDepts.length === 0 ? (
                        <p className="text-xs text-[#72246C]/45 text-center py-8 font-mono">ยังไม่มีข้อมูลคะแนนอนุมัติรายฝ่าย</p>
                      ) : (
                        sortedDepts.map((dept, idx) => {
                          const maxVal = sortedDepts[0]?.kcal || 1;
                          const percentage = (dept.kcal / maxVal) * 100;
                          return (
                            <div key={dept.name} className="space-y-2">
                              <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center font-bold">
                                    {idx === 0 ? <Crown className="h-3 w-3 text-[#C69214]" /> : 
                                     idx === 1 ? <Medal className="h-3 w-3 text-[#72246C]/80" /> :
                                     idx === 2 ? <Medal className="h-3 w-3 text-[#9A650F]" /> : 
                                     <span className="text-[10px] text-[#72246C]/45 font-mono">{idx + 1}</span>}
                                  </div>
                                  <span className="font-semibold text-[#72246C]">{dept.name}</span>
                                </div>
                                <span className="font-bold text-[#C69214] font-mono">{dept.kcal.toLocaleString()} kcal</span>
                              </div>
                              <div className="w-full bg-white rounded-full h-1.5 overflow-hidden">
                                <div 
                                  className="bg-gradient-to-r from-[#C69214] to-[#72246C] h-full rounded-full transition-all duration-1000" 
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Division ranking */}
                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-[#72246C] flex items-center gap-2">
                        <Layers className="h-5 w-5 text-[#C69214]" />
                        อันดับตาม "กอง" (Division Leaderboard)
                      </h3>
                      <span className="text-[10px] bg-white text-[#72246C]/65 px-2 py-0.5 rounded font-mono">Kcal Rank</span>
                    </div>

                    <div className="space-y-5 mt-6">
                      {sortedDivs.length === 0 ? (
                        <p className="text-xs text-[#72246C]/45 text-center py-8 font-mono">ยังไม่มีข้อมูลคะแนนอนุมัติรายกอง</p>
                      ) : (
                        sortedDivs.map((div, idx) => {
                          const maxVal = sortedDivs[0]?.kcal || 1;
                          const percentage = (div.kcal / maxVal) * 100;
                          return (
                            <div key={div.name} className="space-y-2">
                              <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center font-bold">
                                    {idx === 0 ? <Crown className="h-3 w-3 text-[#C69214]" /> : 
                                     idx === 1 ? <Medal className="h-3 w-3 text-[#72246C]/80" /> :
                                     idx === 2 ? <Medal className="h-3 w-3 text-[#9A650F]" /> : 
                                     <span className="text-[10px] text-[#72246C]/45 font-mono">{idx + 1}</span>}
                                  </div>
                                  <span className="font-semibold text-[#72246C]">{div.name}</span>
                                </div>
                                <span className="font-bold text-[#C69214] font-mono">{div.kcal.toLocaleString()} kcal</span>
                              </div>
                              <div className="w-full bg-white rounded-full h-1.5 overflow-hidden">
                                <div 
                                  className="bg-gradient-to-r from-[#72246C] to-[#C69214] h-full rounded-full transition-all duration-1000" 
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* SEARCH HISTORIES PORTLET */}
                <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h3 className="text-lg font-bold text-[#72246C]">ตรวจสอบประวัติสถิติรายบุคคล</h3>
                      <p className="text-xs text-[#72246C]/65">ระบุรหัสพนักงานเพื่อดูประวัติและผลลัพธ์ย้อนหลังทั้งหมด</p>
                    </div>
                    <div className="relative w-full sm:w-72">
                      <input 
                        type="text" 
                        placeholder="กรอกรหัส เช่น EMP1001..." 
                        value={searchId}
                        onChange={(e) => setSearchId(e.target.value)}
                        className="w-full bg-white border border-[#C69214]/20 focus:border-[#C69214] rounded-lg py-2 pl-9 pr-4 text-sm text-[#72246C]/80 transition-all focus:outline-none"
                      />
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#72246C]/45 pointer-events-none">
                        <Search className="h-4 w-4" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-5 border border-[#C69214]/20">
                    <div className="flex flex-col sm:flex-row justify-between pb-4 border-b border-[#C69214]/20 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#C69214] font-bold border border-[#C69214]/15">
                          <User className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-[#72246C] text-sm">
                            {searchEmployee ? searchEmployee.name : '-'}
                          </h4>
                          <p className="text-xs text-[#72246C]/45">
                            {searchEmployee 
                              ? `ฝ่าย: ${searchEmployee.department} • กอง: ${searchEmployee.division}` 
                              : 'กรอกรหัสพนักงานที่ต้องการสืบค้นข้อมูลด้านบน'}
                          </p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] text-[#72246C]/45 block">ยอดรวมแคลอรี่อนุมัติแล้ว</span>
                        <span className="text-lg font-bold text-[#C69214] font-mono">
                          {searchApprovedKcal.toLocaleString()} kcal
                        </span>
                      </div>
                    </div>
                    
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="text-[#72246C]/65 border-b border-[#C69214]/20 font-semibold font-mono">
                            <th className="py-2.5">วันและเวลาบันทึก</th>
                            <th className="py-2.5">ประเภทกิจกรรม</th>
                            <th className="py-2.5">แคลอรี่สกัดได้</th>
                            <th className="py-2.5">ผลการตรวจสอบ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2A0D27]/60 font-mono">
                          {searchSubmissions.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="text-center py-6 text-[#72246C]/45 font-sans">
                                {searchId.trim() ? 'ไม่พบข้อมูลประวัติการส่งออกกำลังกาย' : 'ไม่มีประวัติแสดงผล'}
                              </td>
                            </tr>
                          ) : (
                            [...searchSubmissions].reverse().map(sub => {
                              let statusStyles = "text-[#72246C]/65 bg-white border-[#C69214]/20";
                              let statusText = "รออนุมัติ";
                              if (sub.status === 'approved') {
                                statusStyles = "text-[#C69214] bg-[#C69214]/10 border-[#C69214]/20";
                                statusText = "อนุมัติแล้ว";
                              } else if (sub.status === 'rejected') {
                                statusStyles = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                                statusText = "ปฏิเสธ";
                              }
                              return (
                                <tr key={sub.id} className="hover:bg-white">
                                  <td className="py-3 text-[#72246C]/80">{sub.timestamp}</td>
                                  <td className="py-3 text-[#72246C] font-sans">{sub.activityType}</td>
                                  <td className="py-3 font-bold text-[#72246C]">{sub.kcal} kcal</td>
                                  <td className="py-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold border ${statusStyles} font-sans`}>
                                      {statusText}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: ADMIN APPROVAL QUEUE */}
            {activeTab === 'admin-portal' && (
              isAdminAuthenticated ? (
              <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-6 border-b border-[#C69214]/20">
                  <div>
                    <h2 className="text-xl font-bold text-[#72246C] flex items-center gap-2 m-0">
                      <ShieldCheck className="h-6 w-6 text-[#C69214]" />
                      ระบบควบคุม: งานอนุมัติสถิติประจำวัน
                    </h2>
                    <p className="text-xs text-[#72246C]/65 mt-1 mb-0">
                      ตรวจสอบความถูกต้องสอดคล้องของหลักฐานภาพนาฬิกา และตัดสินใจบันทึกคะแนนเข้าสู่ระบบส่วนกลาง
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleApproveAll}
                      className="px-4 py-2.5 bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold text-xs rounded-xl shadow-lg shadow-[#C69214]/10 transition-colors flex items-center gap-1.5"
                    >
                      <Check className="h-4 w-4 stroke-[3]" />
                      <span>อนุมัติทั้งหมดในคิว ({pendingQueue.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAdminLogout}
                      className="px-3 py-2.5 bg-white hover:bg-[#3A1536] text-[#72246C]/65 hover:text-[#72246C] font-bold text-xs rounded-xl border border-[#C69214]/20 transition-colors flex items-center gap-1.5"
                    >
                      <LogOut className="h-4 w-4" />
                      ออกจากระบบ
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#C69214]/15 text-[#72246C]/65 text-xs bg-[#72246C]/5 font-semibold">
                        <th className="py-4 px-4">ชื่อพนักงาน / สังกัด</th>
                        <th className="py-4 px-4">ประเภทกิจกรรม</th>
                        <th className="py-4 px-4">หลักฐานภาพถ่าย</th>
                        <th className="py-4 px-4 text-[#C69214] font-mono">Kcal</th>
                        <th className="py-4 px-4">ผลการแฮชสแกน</th>
                        <th className="py-4 px-4 text-center">จัดการคำขอ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C69214]/20 text-sm font-sans">
                      {pendingQueue.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-16 text-center text-[#72246C]/45">
                            <div className="flex flex-col items-center justify-center gap-2">
                              <ShieldCheck className="h-8 w-8 text-[#72246C]/25" />
                              <span className="font-semibold text-sm">ไม่มีสถิติรอดำเนินการในขณะนี้</span>
                              <p className="text-xs text-[#72246C]/35">สถิติทั้งหมดได้รับการตรวจสอบเรียบร้อยแล้ว</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        pendingQueue.map(sub => (
                          <tr key={sub.id} className="hover:bg-[#72246C]/5 transition-colors">
                            <td className="py-4 px-4">
                              <div className="font-bold text-[#72246C]">{sub.name}</div>
                              <div className="text-xs text-[#72246C]/65 font-mono">
                                {sub.empId} • {sub.department} ({sub.division})
                              </div>
                            </td>
                            <td className="py-4 px-4 text-[#72246C]/80">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-[#C69214]"></span>
                                <span>{sub.activityType}</span>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <a 
                                href={sub.imageUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="block w-16 h-12 rounded-lg overflow-hidden border border-[#C69214]/20 hover:scale-150 hover:border-[#C69214] transition-all cursor-zoom-in relative bg-white"
                              >
                                <img src={sub.imageUrl} className="w-full h-full object-contain" alt="Verification proof" />
                              </a>
                            </td>
                            <td className="py-4 px-4 font-mono font-bold text-[#C69214] text-lg">
                              {sub.kcal}
                            </td>
                            <td className="py-4 px-4 font-mono text-xs text-[#72246C]/65">
                              <div className="truncate max-w-[120px]" title={sub.imageHash}>
                                Hash: {sub.imageHash?.substring(0, 12)}...
                              </div>
                              <div className="text-[10px] text-[#C69214] font-semibold flex items-center gap-0.5 mt-0.5">
                                <Calendar className="h-3 w-3" />
                                {sub.timestamp}
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex justify-center gap-2">
                                <button 
                                  onClick={() => handleApprove(sub.id)}
                                  className="px-3 py-1.5 bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Check className="h-3.5 w-3.5 stroke-[3]" /> อนุมัติ
                                </button>
                                <button 
                                  onClick={() => handleReject(sub.id)}
                                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold text-xs rounded-lg border border-rose-500/20 transition-colors flex items-center gap-1"
                                >
                                  <X className="h-3.5 w-3.5 stroke-[3]" /> ปฏิเสธ
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              ) : (
              <div className="max-w-md mx-auto bg-white border border-[#C69214]/20 rounded-2xl p-6 shadow-xl">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-white border border-[#C69214]/20 flex items-center justify-center mx-auto mb-3 text-[#C69214]">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-[#72246C] m-0">เข้าสู่หลังบ้าน</h2>
                  <p className="text-xs text-[#72246C]/65 mt-2 mb-0">
                    สำหรับผู้ดูแลระบบเพื่อตรวจสอบและอนุมัติข้อมูลกิจกรรม
                  </p>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#72246C]/65 mb-2">อีเมลผู้ดูแลระบบ</label>
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full bg-white border border-[#C69214]/20 rounded-xl px-4 py-3 text-sm text-[#72246C] focus:outline-none focus:border-[#C69214]/60"
                      placeholder="admin@pea.co.th"
                      autoComplete="username"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#72246C]/65 mb-2">รหัสผ่าน</label>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full bg-white border border-[#C69214]/20 rounded-xl px-4 py-3 text-sm text-[#72246C] focus:outline-none focus:border-[#C69214]/60"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                  </div>

                  {adminLoginError && (
                    <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                      {adminLoginError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold py-3 rounded-xl text-sm transition-colors"
                  >
                    เข้าสู่ระบบหลังบ้าน
                  </button>
                </form>
              </div>
              )
            )}

            {/* TAB 4: SYSTEM SPECIFICATION */}
            {activeTab === 'system-spec' && (
              <div className="bg-white border border-[#C69214]/20 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#C69214] to-[#72246C]"></div>
                
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-[#C69214]/20">
                  <div>
                    <h2 className="text-xl font-bold text-[#C69214] flex items-center gap-2 m-0">
                      <FileCode className="h-6 w-6" />
                      เอกสารความต้องการระบบและการจัดทำ (System Specifications)
                    </h2>
                    <p className="text-xs text-[#72246C]/65 mt-1 mb-0">
                      รายละเอียดโครงสร้างสเปกสำหรับเซ็ตอัป Supabase ฐานข้อมูล และ Storage จริงด้วยตนเอง
                    </p>
                  </div>
                  <button 
                    onClick={handleDownloadSpec}
                    className="bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-[#C69214]/10 transition-all"
                  >
                    <UploadCloud className="h-4 w-4" /> 
                    ดาวน์โหลดไฟล์ specification.md
                  </button>
                </div>

                <div className="prose prose-invert max-w-none text-[#72246C]/80 text-sm space-y-6 mt-6 leading-relaxed">
                  <div>
                    <h3 className="text-base font-bold text-[#72246C] mb-2 font-mono border-b border-[#C69214]/20 pb-2">1. Tech Stack (0 Baht budget stack)</h3>
                    <ul className="list-disc pl-5 space-y-1.5 text-[#72246C]/65 text-xs">
                      <li><b>Frontend Platform:</b> React 19 + TypeScript + Tailwind CSS โฮสต์ฟรีบน Vercel</li>
                      <li><b>Database Engines:</b> Supabase (PostgreSQL) Free Tier สำหรับข้อมูลหลักและอันดับคะแนน</li>
                      <li><b>Proof Storage Bucket:</b> Supabase Storage (เก็บไฟล์รูปหลักฐาน)</li>
                      <li><b>Manual kcal entry:</b> ผู้ใช้กรอกค่า kcal จากภาพหลักฐานด้วยตนเองเพื่อลดความคลาดเคลื่อน</li>
                      <li><b>Image Hashing:</b> SHA-256 (Web Crypto API) เพื่อป้องกันรูปเก่าส่งซ้ำ</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-[#72246C] mb-2 font-mono border-b border-[#C69214]/20 pb-2">2. Database Schema SQL Definitions</h3>
                    <div className="bg-white p-4 rounded-xl font-mono text-[11px] text-[#C69214] border border-[#C69214]/20 space-y-4">
                      <div>
                        <span className="text-[#72246C]/45">-- ตารางข้อมูลสังกัดและชื่อพนักงาน</span><br />
                        <span className="text-[#C69214]">CREATE TABLE</span> employees (<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;emp_id <span className="text-[#72246C]">VARCHAR(50) PRIMARY KEY</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;name <span className="text-[#72246C]">VARCHAR(255) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;department <span className="text-[#72246C]">VARCHAR(255) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;division <span className="text-[#72246C]">VARCHAR(255) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;created_at <span className="text-[#72246C]">TIMESTAMP WITH TIME ZONE DEFAULT NOW()</span><br />
                        );
                      </div>
                      <div className="border-t border-[#C69214]/20 pt-2">
                        <span className="text-[#72246C]/45">-- ตารางบันทึกการส่งคะแนนและการตรวจสอบ</span><br />
                        <span className="text-[#C69214]">CREATE TABLE</span> submissions (<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;id <span className="text-[#72246C]">BIGSERIAL PRIMARY KEY</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;emp_id <span className="text-[#72246C]">VARCHAR(50) REFERENCES</span> employees(emp_id),<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;activity_type <span className="text-[#72246C]">VARCHAR(100) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;kcal <span className="text-[#72246C]">INT NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;image_url <span className="text-[#72246C]">TEXT NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;image_hash <span className="text-[#72246C]">VARCHAR(64) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;scanned_date <span className="text-[#72246C]">DATE NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;status <span className="text-[#72246C]">VARCHAR(50) DEFAULT 'pending'</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;created_at <span className="text-[#72246C]">TIMESTAMP WITH TIME ZONE DEFAULT NOW()</span><br />
                        );
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-[#72246C] mb-2 font-mono border-b border-[#C69214]/20 pb-2">3. Business Verification Rules</h3>
                    <ul className="list-decimal pl-5 space-y-2 text-[#72246C]/65 text-xs">
                      <li><b>กฎจำกัดส่งรายวัน:</b> ตรวจสอบ `scanned_date` ในฐานข้อมูล โดยพนักงาน 1 รหัสต้องส่งได้สูงสุด 1 รายการ ต่อวัน (ยกเว้นรายการเดิมถูก Reject สามารถส่งใหม่ได้)</li>
                      <li><b>ตรวจสอบการเวียนรูปภาพหลักฐาน:</b> เมื่อผู้ใช้อัปโหลดรูป โปรแกรมจะทำ Hash หากค่าแฮชรูปตรงกับที่เคยมีอยู่ในตาราง ระบบจะไม่ยอมรับเพื่อสกัดการทุจริต</li>
                      <li><b>การจัดลีดเดอร์บอร์ด:</b> สถิติคำนวณจากตาราง submissions เฉพาะแถวที่มีสเตตัส `approved` เท่านั้น</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* TOAST POPUP */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 transform transition-all duration-300 translate-y-0 opacity-100">
          <div className={`border rounded-2xl p-4 shadow-2xl flex items-center gap-3 bg-white ${
            toast.type === 'success' ? 'border-[#C69214]/30 text-[#C69214]' : 'border-rose-500/30 text-rose-400'
          }`}>
            {toast.type === 'success' ? <Check className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            <div>
              <p className="font-bold text-sm text-[#72246C] m-0">{toast.title}</p>
              <p className="text-xs text-[#72246C]/65 m-0 mt-0.5">{toast.desc}</p>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-white border-t border-[#C69214]/20 py-4 text-center text-[#72246C]/45 text-xs">
        <p className="m-0">2026 PEA Titan Move • All Rights Reserved</p>
      </footer>
    </div>
  );
}
