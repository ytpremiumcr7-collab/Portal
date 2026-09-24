import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const allTypes=["CONVOCATORIA","FUNDAMENTO_JURIDICO","PLIEGO_TECNICO","PLIEGO_ADMINISTRATIVO","JUNTA_ACLARACIONES","ACTA_APERTURA","OFERTA_TECNICA","OFERTA_ECONOMICA","GARANTIA","ACTA_EVALUACION","DICTAMEN","FALLO_ADJUDICACION","CONTRATO","FACTURA","OTRO"] as const;
const providerTypes=["OFERTA_TECNICA","OFERTA_ECONOMICA","GARANTIA"] as const;
const offerTypes=new Set<string>(["OFERTA_TECNICA","OFERTA_ECONOMICA"]);

export default function Documentos(){
  const {user}=useAuth({redirectOnUnauthenticated:true});
  const [params]=useSearchParams();
  const [page,setPage]=useState(1);
  const [file,setFile]=useState<File|null>(null);
  const [licitacionId,setLicitacionId]=useState(params.get("licitacionId")??"");
  const [proveedorId,setProveedorId]=useState(params.get("proveedorId")??"");
  const [lotId,setLotId]=useState(params.get("lotId")??"");
  const types=useMemo(()=>user?.role==="proveedor"?providerTypes:allTypes,[user?.role]);
  const requestedType=params.get("tipo");
  const [tipo,setTipo]=useState<typeof allTypes[number]>(
    allTypes.includes(requestedType as typeof allTypes[number]) ? requestedType as typeof allTypes[number] : "CONVOCATORIA",
  );
  const selectedType=user?.role==="proveedor"&&!providerTypes.includes(tipo as typeof providerTypes[number])?"OFERTA_TECNICA":tipo;

  const licIdNum=Number(licitacionId)||0;
  const docs=trpc.documentos.list.useQuery({
    page,pageSize:20,
    licitacionId:licIdNum||undefined,
    lotId:lotId?Number(lotId):undefined,
  });
  const reps=trpc.proveedores.myRepresentations.useQuery(undefined,{enabled:user?.role==="proveedor"});
  const context=trpc.participaciones.submissionContext.useQuery(
    {licitacionId:licIdNum},
    {enabled:user?.role==="proveedor"&&licIdNum>0},
  );
  const procedureLots=trpc.lots.list.useQuery(
    {licitacionId:licIdNum},
    {enabled:user?.role!=="proveedor"&&licIdNum>0},
  );
  const upload=trpc.documentos.upload.useMutation({onSuccess:()=>{setFile(null);docs.refetch();}});
  const aprobar=trpc.documentos.cambiarEstado.useMutation({onSuccess:()=>docs.refetch()});
  const remove=trpc.documentos.delete.useMutation({onSuccess:()=>docs.refetch()});

  const needsLot=offerTypes.has(selectedType)||selectedType==="CONTRATO";
  const availableLots=user?.role==="proveedor"?(context.data?.lots??[]):(procedureLots.data??[]);
  const submit=async()=>{
    if(!file||!licitacionId)return;
    if(user?.role==="proveedor"&&!proveedorId)return;
    if(needsLot&&!lotId)return;
    const base64=await new Promise<string>((resolve,reject)=>{
      const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);
    });
    upload.mutate({
      licitacionId:Number(licitacionId),
      lotId:lotId?Number(lotId):undefined,
      proveedorId:user?.role==="proveedor"?Number(proveedorId):undefined,
      tipo:selectedType,nombreArchivo:file.name,mimeType:file.type||"application/octet-stream",
      contentBase64:base64,esPublico:user?.role!=="proveedor",
    });
  };

  return <div className="space-y-5">
    <PageHeader title="Expediente documental" description="Evidencia versionada del procedimiento. Las ofertas del proveedor se vinculan a organización y lote." breadcrumbs={[{label:"Documentos"}]} />
    <section className="ares-panel space-y-4 p-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label className="text-xs">Procedimiento</Label><Input placeholder="ID" value={licitacionId} onChange={e=>{setLicitacionId(e.target.value);setLotId("");}} /></div>
        {user?.role==="proveedor"&&<div>
          <Label className="text-xs">Organización representada</Label>
          <Select value={proveedorId} onValueChange={setProveedorId}><SelectTrigger><SelectValue placeholder="Organización" /></SelectTrigger><SelectContent>
            {(reps.data??[]).map((p)=><SelectItem key={p.id} value={String(p.id)}>{p.razonSocial}</SelectItem>)}
          </SelectContent></Select>
        </div>}
        <div><Label className="text-xs">Tipo</Label><Select value={selectedType} onValueChange={v=>setTipo(v as typeof allTypes[number])}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{types.map(t=><SelectItem key={t} value={t}>{t.replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></div>
        {needsLot&&<div>
          <Label className="text-xs">Lote</Label>
          <Select value={lotId} onValueChange={setLotId}><SelectTrigger><SelectValue placeholder="Lote" /></SelectTrigger><SelectContent>
            {availableLots.map((l)=><SelectItem key={l.id} value={String(l.id)}>{l.code} · {l.title}</SelectItem>)}
          </SelectContent></Select>
        </div>}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Input type="file" onChange={e=>setFile(e.target.files?.[0]??null)} className="max-w-md" />
        <Button onClick={submit} disabled={!file||!licitacionId||upload.isPending||(needsLot&&!lotId)||(user?.role==="proveedor"&&!proveedorId)}>
          {upload.isPending?"Subiendo…":"Subir documento"}
        </Button>
      </div>
      {upload.error&&<p className="text-sm text-red-700">{upload.error.message}</p>}
    </section>

    <section className="ares-panel overflow-x-auto">
      <table className="ares-table"><thead><tr><th>Archivo</th><th>Tipo</th><th>Lote</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead>
        <tbody>{(docs.data?.items??[]).map((d)=><tr key={d.id}>
          <td>{d.nombreArchivo}</td><td>{d.tipo}</td><td>{d.lotId??"—"}</td><td>{d.estado}</td>
          <td className="space-x-2 text-right">
            <a className="text-sm underline" href={`/api/documents/${d.id}/download`}>Descargar</a>
            {user?.role!=="proveedor"&&d.estado==="PENDIENTE"&&<Button size="sm" onClick={()=>aprobar.mutate({id:d.id,estado:"VALIDANDO",motivo:"Inicio de validación documental"})}>Validar</Button>}
            {user?.role!=="proveedor"&&d.estado==="VALIDANDO"&&<Button size="sm" onClick={()=>aprobar.mutate({id:d.id,estado:"APROBADO",motivo:"Aprobación documental"})}>Aprobar</Button>}
            {user?.role!=="proveedor"&&<Button size="sm" variant="destructive" onClick={()=>remove.mutate({id:d.id,motivo:"Eliminación administrativa"})}>Eliminar</Button>}
          </td>
        </tr>)}</tbody>
      </table>
    </section>
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span className="self-center text-sm text-slate-500">Página {page} de {docs.data?.pageCount??1}</span><Button variant="outline" disabled={!docs.data||page>=docs.data.pageCount} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div>
  </div>;
}
