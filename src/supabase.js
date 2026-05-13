import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Safety check to prevent app from crashing if env vars are missing during setup
export const supabase = (typeof supabaseUrl === 'string' && supabaseUrl.startsWith('http') && typeof supabaseAnonKey === 'string' && supabaseAnonKey.startsWith('eyJ')) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : { 
      from: () => ({ 
        select: () => ({ 
          eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: "Mock Mode: Missing or Invalid Keys in .env" } }) }),
          limit: () => Promise.resolve({ data: [], error: { message: "Mock Mode: Missing or Invalid Keys in .env" } })
        }), 
        upsert: () => Promise.resolve({ error: { message: "Mock Mode" } }) 
      }), 
      storage: { from: () => ({ upload: () => Promise.resolve({ error: true }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } 
    };

export const uploadFile = async (file, bucket = 'task-attachments') => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file);

  if (error) throw error;
  return { path: filePath, name: file.name };
};

export const getFileUrl = (path, bucket = 'task-attachments') => {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};
