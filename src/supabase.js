import { createClient } from '@supabase/supabase-js'

// HARDCODED KEYS FOR GUARANTEED CONNECTION
const supabaseUrl = 'https://rthttabfrxoguxkvjslu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0aHR0YWJmcnhvZ3V4a3Zqc2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMjgsImV4cCI6MjA5Mzc0MjIyOH0.AGS8fbmpTDIWRQYygixdNVmjxEchlhiYgzeFGYd5aug'

// Always use the real client, no more mock mode
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
