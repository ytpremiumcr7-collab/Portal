import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const navigate=useNavigate(); const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const login=trpc.auth.login.useMutation({onSuccess:()=>navigate("/"),});
  const submit=(e:FormEvent)=>{e.preventDefault();login.mutate({email,password});};
  return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4"><Card className="w-full max-w-md border-slate-700 bg-slate-900"><CardHeader><CardTitle className="text-white">ARES Engine MX</CardTitle><p className="text-sm text-slate-400">Acceso autenticado por organización</p></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><div><Label className="text-slate-300">Correo</Label><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required className="bg-slate-800 border-slate-700 text-white"/></div><div><Label className="text-slate-300">Contraseña</Label><Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required className="bg-slate-800 border-slate-700 text-white"/></div>{login.error&&<p className="text-sm text-red-400">{login.error.message}</p>}<Button type="submit" disabled={login.isPending} className="w-full bg-amber-600 hover:bg-amber-700">{login.isPending?"Validando…":"Iniciar sesión"}</Button></form><div className="mt-5 text-center text-sm text-slate-400">¿Primera cuenta? <Link to="/registro" className="text-amber-400 hover:text-amber-300">Crear organización</Link></div></CardContent></Card></div>;
}
