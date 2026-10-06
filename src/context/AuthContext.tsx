import React,{createContext,useContext,useEffect,useState}from'react';
import {UserProfile,UserRole}from'../types';
import {supabase}from'../lib/supabase';

interface AuthContextType{user:UserProfile|null;role:UserRole;isAuthenticated:boolean;isAdmin:boolean;isOwner:boolean;loading:boolean;login:(email:string,password?:string)=>Promise<boolean>;register:(name:string,email:string,password?:string)=>Promise<boolean>;requestPasswordReset:(email:string)=>Promise<void>;logout:()=>Promise<void>;}
const AuthContext=createContext<AuthContextType|undefined>(undefined);

export const AuthProvider:React.FC<{children:React.ReactNode}>=({children})=>{
 const [user,setUser]=useState<UserProfile|null>(null); const [loading,setLoading]=useState(true);
 const refresh=async(session:any)=>{
  if(!supabase||!session){setUser(null);return;}
  const {data:profile}=await supabase.from('profiles').select('id,role,display_name,avatar_url,locale,created_at').eq('id',session.user.id).single();
  if(profile)setUser({id:session.user.id,email:session.user.email||'',name:profile.display_name,role:profile.role,avatarUrl:profile.avatar_url||'',preferredLanguage:profile.locale,createdAt:profile.created_at});
  else setUser({id:session.user.id,email:session.user.email||'',name:session.user.user_metadata?.display_name||'',role:'USER',avatarUrl:'',preferredLanguage:'ar',createdAt:session.user.created_at} as UserProfile);
 };
 useEffect(()=>{if(!supabase){setLoading(false);return;}let active=true;supabase.auth.getSession().then(async({data})=>{if(active){await refresh(data.session);setLoading(false);}});const{data}=supabase.auth.onAuthStateChange((_e,session)=>{if(active)void refresh(session);});return()=>{active=false;data.subscription.unsubscribe();};},[]);
 const login=async(email:string,password='')=>{if(!supabase)throw new Error('Authentication is unavailable until Supabase is configured.');const{data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;await refresh(data.session);return true;};
 const register=async(name:string,email:string,password='')=>{if(!supabase)throw new Error('Authentication is unavailable until Supabase is configured.');const{data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:name}}});if(error)throw error;if(data.session)await refresh(data.session);return true;};
 const requestPasswordReset=async(email:string)=>{if(!supabase)throw new Error('Authentication is unavailable until Supabase is configured.');const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/reset-password`});if(error)throw error;};
 const logout=async()=>{if(supabase)await supabase.auth.signOut();setUser(null);};
 const role=user?.role||'USER';
 return <AuthContext.Provider value={{user,role,isAuthenticated:!!user,isAdmin:role==='ADMIN'||role==='OWNER',isOwner:role==='OWNER',loading,login,register,requestPasswordReset,logout}}>{children}</AuthContext.Provider>;
};
export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error('useAuth must be used within AuthProvider');return c;};