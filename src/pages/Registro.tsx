import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Registro() {
  const navigate=useNavigate();
  const [f,setF]=useState({tenantNombre:"",tenantRfc:"",name:"",email:"",password:""});
  const register=trpc.auth.register.useMutation({onSuccess:()=>navigate("/")});
  const set=(k:keyof typeof f,v:string)=>setF(x=>({...x,[k]:v}));
  const submit=(e:FormEvent)=>{e.preventDefault();register.mutate(f)};
  return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4"><Card className="w-full max-w-xl border-slate-700 bg-slate-900"><CardHeader><CardTitle className="text-white">Registro ARES Engine MX</CardTitle><p className="text-sm text-slate-400">Crea una organización mexicana y su primera cuenta administradora.</p></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4">{([['tenantNombre','Organización'],['tenantRfc','RFC de la organización'],['name','Nombre del administrador'],['email','Correo'],['password','Contraseña (mínimo 12 caracteres)']] as const).map(([k,l])=><div key={k}><Label className="text-slate-300">{l}</Label><Input type={k==='password'?'password':'text'} value={f[k]} onChange={e=>set(k,e.target.value)} required className="bg-slate-800 border-slate-700 text-white"/></div>)}{register.error&&<p className="text-sm text-red-400">{register.error.message}</p>}<div className="flex gap-3"><Button type="submit" disabled={register.isPending} className="bg-amber-600 hover:bg-amber-700">{register.isPending?'Creando…':'Crear organización'}</Button><Link to="/login"><Button type="button" variant="outline" className="border-slate-600 text-slate-300">Volver</Button></Link></div></form></CardContent></Card></div>;
}
