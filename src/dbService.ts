import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Initial mock employees
const INITIAL_EMPLOYEES: Record<string, Employee> = {
  "EMP1001": { empId: "EMP1001", name: "สมชาย รักดี", department: "เทคโนโลยีสารสนเทศ", division: "พัฒนาซอฟต์แวร์" },
  "EMP1002": { empId: "EMP1002", name: "สมศรี ใจงาม", department: "ทรัพยากรบุคคล", division: "สรรหาบุคลากร" },
  "EMP1003": { empId: "EMP1003", name: "วันชัย กล้าหาญ", department: "ฝ่ายขาย", division: "พัฒนาธุรกิจ" },
  "EMP1004": { empId: "EMP1004", name: "นภา ดาราเพ็ญ", department: "การตลาด", division: "ประชาสัมพันธ์" },
  "EMP1005": { empId: "EMP1005", name: "วิทยา ใฝ่รู้", department: "เทคโนโลยีสารสนเทศ", division: "โครงสร้างพื้นฐาน" }
};

// Initial mock submissions
const INITIAL_SUBMISSIONS: Submission[] = [
  { id: 1, empId: "EMP1001", name: "สมชาย รักดี", department: "เทคโนโลยีสารสนเทศ", division: "พัฒนาซอฟต์แวร์", activityType: "วิ่ง", kcal: 450, imageUrl: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400", scannedDate: "2026-07-07", status: "approved", timestamp: "2026-07-07 08:30" },
  { id: 2, empId: "EMP1002", name: "สมศรี ใจงาม", department: "ทรัพยากรบุคคล", division: "สรรหาบุคลากร", activityType: "เดิน", kcal: 250, imageUrl: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=400", scannedDate: "2026-07-07", status: "approved", timestamp: "2026-07-07 09:15" },
  { id: 3, empId: "EMP1003", name: "วันชัย กล้าหาญ", department: "ฝ่ายขาย", division: "พัฒนาธุรกิจ", activityType: "ปั่นจักรยาน", kcal: 620, imageUrl: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400", scannedDate: "2026-07-07", status: "pending", timestamp: "2026-07-07 10:00" },
  { id: 4, empId: "EMP1004", name: "นภา ดาราเพ็ญ", department: "การตลาด", division: "ประชาสัมพันธ์", activityType: "บอดี้เวท / ยิม", kcal: 350, imageUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400", scannedDate: "2026-07-06", status: "pending", timestamp: "2026-07-07 11:20" }
];

export interface Employee {
  empId: string;
  name: string;
  department: string;
  division: string;
}

export interface Submission {
  id: number;
  empId: string;
  name: string;
  department: string;
  division: string;
  activityType: string;
  kcal: number;
  imageUrl: string;
  scannedDate: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
  imageHash?: string;
}

// Helpers for LocalStorage Mock DB
const getLocalSubmissions = (): Submission[] => {
  const data = localStorage.getItem('fitverify_submissions');
  if (!data) {
    localStorage.setItem('fitverify_submissions', JSON.stringify(INITIAL_SUBMISSIONS));
    return INITIAL_SUBMISSIONS;
  }
  return JSON.parse(data);
};

const saveLocalSubmissions = (submissions: Submission[]) => {
  localStorage.setItem('fitverify_submissions', JSON.stringify(submissions));
};

export const dbService = {
  isMock: !isSupabaseConfigured,

  async getEmployees(): Promise<Record<string, Employee>> {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('employees').select('*');
        if (error) throw error;
        const result: Record<string, Employee> = {};
        data?.forEach((row: any) => {
          result[row.emp_id] = {
            empId: row.emp_id,
            name: row.name,
            department: row.department,
            division: row.division
          };
        });
        // If Supabase table is empty, return initial mock list as default
        if (Object.keys(result).length === 0) {
          return INITIAL_EMPLOYEES;
        }
        return result;
      } catch (err) {
        console.error('Supabase getEmployees error, falling back to mock:', err);
        return INITIAL_EMPLOYEES;
      }
    }
    return INITIAL_EMPLOYEES;
  },

  async getSubmissions(): Promise<Submission[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('submissions').select('*, employees(*)').order('id', { ascending: true });
        if (error) throw error;
        return data?.map((row: any) => ({
          id: row.id,
          empId: row.emp_id,
          name: row.employees?.name || row.emp_id,
          department: row.employees?.department || 'ไม่ระบุ',
          division: row.employees?.division || 'ไม่ระบุ',
          activityType: row.activity_type,
          kcal: row.kcal,
          imageUrl: row.image_url,
          scannedDate: row.scanned_date || row.submission_date,
          status: row.status,
          timestamp: new Date(row.created_at || row.submission_date).toISOString().replace('T', ' ').substring(0, 16)
        })) || [];
      } catch (err) {
        console.error('Supabase getSubmissions error, falling back to local:', err);
        return getLocalSubmissions();
      }
    }
    return getLocalSubmissions();
  },

  async createSubmission(sub: Omit<Submission, 'id'>): Promise<Submission> {
    if (supabase) {
      try {
        let imageUrl = sub.imageUrl;
        if (imageUrl.startsWith('data:image')) {
          // Convert base64 to file
          const res = await fetch(imageUrl);
          const blob = await res.blob();
          const file = new File([blob], `${sub.empId}-${Date.now()}.jpg`, { type: 'image/jpeg' });
          
          const bucketName = 'fitverify_evidence';
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(`${sub.empId}/${file.name}`, file, { cacheControl: '3600', upsert: false });
          
          if (uploadError) throw uploadError;
          
          const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(uploadData.path);
          imageUrl = urlData.publicUrl;
        }

        const { data, error } = await supabase.from('submissions').insert([
          {
            emp_id: sub.empId,
            activity_type: sub.activityType,
            kcal: sub.kcal,
            image_url: imageUrl,
            image_hash: sub.imageHash || 'none',
            scanned_date: sub.scannedDate,
            status: sub.status
          }
        ]).select().single();

        if (error) throw error;
        
        return {
          id: data.id,
          empId: data.emp_id,
          name: sub.name,
          department: sub.department,
          division: sub.division,
          activityType: data.activity_type,
          kcal: data.kcal,
          imageUrl: data.image_url,
          scannedDate: data.scanned_date,
          status: data.status,
          timestamp: new Date(data.created_at).toISOString().replace('T', ' ').substring(0, 16)
        };
      } catch (err) {
        console.error('Supabase createSubmission error, falling back to local:', err);
      }
    }
    
    // Local fallback
    const local = getLocalSubmissions();
    const newSub: Submission = {
      ...sub,
      id: local.length > 0 ? Math.max(...local.map(s => s.id)) + 1 : 1
    };
    local.push(newSub);
    saveLocalSubmissions(local);
    return newSub;
  },

  async updateStatus(id: number, status: 'approved' | 'rejected'): Promise<boolean> {
    if (supabase) {
      try {
        const { error } = await supabase.from('submissions').update({ status }).eq('id', id);
        if (error) throw error;
        return true;
      } catch (err) {
        console.error('Supabase updateStatus error, falling back to local:', err);
      }
    }
    
    const local = getLocalSubmissions();
    const idx = local.findIndex(s => s.id === id);
    if (idx !== -1) {
      local[idx].status = status;
      saveLocalSubmissions(local);
      return true;
    }
    return false;
  },

  async approveAll(): Promise<number> {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('submissions').update({ status: 'approved' }).eq('status', 'pending').select();
        if (error) throw error;
        return data?.length || 0;
      } catch (err) {
        console.error('Supabase approveAll error, falling back to local:', err);
      }
    }

    const local = getLocalSubmissions();
    let count = 0;
    local.forEach(s => {
      if (s.status === 'pending') {
        s.status = 'approved';
        count++;
      }
    });
    if (count > 0) {
      saveLocalSubmissions(local);
    }
    return count;
  }
};
