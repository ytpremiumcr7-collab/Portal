import { useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Lots(){
  const [params]=useSearchParams();
  const [licitacionId,setLicitacionId]=useState(params.get("licitacionId")??"");
  const [code,setCode]=useState("");
  const [title,setTitle]=useState("");
  const [amount,setAmount]=useState("");
  const [itemLotId,setItemLotId]=useState("");
  const [itemCode,setItemCode]=useState("");
  const [itemDescription,setItemDescription]=useState("");
  const [quantity,setQuantity]=useState("1");
  const [unit,setUnit]=useState("PZA");
  const licId=Number(licitacionId)||0;
  const utils=trpc.useUtils();
  const list=trpc.lots.list.useQuery({licitacionId:licId},{enabled:licId>0});
  const create=trpc.lots.createLot.useMutation({onSuccess:async()=>{setCode("");setTitle("");setAmount("");await utils.lots.list.invalidate({licitacionId:licId});}});
  const add=trpc.lots.addItem.useMutation({onSuccess:async()=>{setItemCode("");setItemDescription("");await utils.lots.list.invalidate({licitacionId:licId});}});

  return <div className="space-y-5">
    <PageHeader title="Lotes e ítems" description="Estructura contractual del procedimiento antes de publicación." breadcrumbs={[{label:"Procedimientos",href:"/licitaciones"},{label:"Lotes e ítems"}]} />
    <section className="ares-panel p-5">
      <Label>Procedimiento</Label><Input className="mt-1 max-w-xs" value={licitacionId} onChange={e=>setLicitacionId(e.target.value)} placeholder="ID del procedimiento" />
    </section>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="ares-panel p-5 space-y-3">
        <h3 className="font-semibold">Crear lote</h3>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Código</Label><Input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} /></div><div><Label>Monto estimado</Label><Input value={amount} onChange={e=>setAmount(e.target.value)} /></div></div>
        <div><Label>Título</Label><Input value={title} onChange={e=>setTitle(e.target.value)} /></div>
        <Button disabled={!licId||!code||title.length<3||create.isPending} onClick={()=>create.mutate({licitacionId:licId,code,title,estimatedAmount:amount||undefined,motivo:"Estructuración de lotes"})}>Crear lote</Button>
        {create.error&&<p className="text-sm text-red-700">{create.error.message}</p>}
      </section>
      <section className="ares-panel p-5 space-y-3">
        <h3 className="font-semibold">Agregar ítem</h3>
        <select className="h-9 w-full rounded-md border px-3 text-sm" value={itemLotId} onChange={e=>setItemLotId(e.target.value)}>
          <option value="">Seleccione lote</option>{(list.data??[]).filter((l:any)=>l.status!=="CANCELLED").map((l:any)=><option key={l.id} value={l.id}>{l.code} · {l.title}</option>)}
        </select>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Código</Label><Input value={itemCode} onChange={e=>setItemCode(e.target.value)} /></div><div><Label>Unidad</Label><Input value={unit} onChange={e=>setUnit(e.target.value)} /></div></div>
        <div><Label>Descripción</Label><Input value={itemDescription} onChange={e=>setItemDescription(e.target.value)} /></div>
        <div><Label>Cantidad</Label><Input value={quantity} onChange={e=>setQuantity(e.target.value)} /></div>
        <Button disabled={!licId||!itemLotId||!itemCode||itemDescription.length<3||add.isPending} onClick={()=>add.mutate({licitacionId:licId,lotId:Number(itemLotId),code:itemCode,description:itemDescription,quantity,unit,motivo:"Alta de ítem del lote"})}>Agregar ítem</Button>
        {add.error&&<p className="text-sm text-red-700">{add.error.message}</p>}
      </section>
    </div>
    <section className="ares-panel overflow-x-auto">
      <table className="ares-table"><thead><tr><th>Lote</th><th>Estado</th><th>Monto</th><th>Ítems</th></tr></thead><tbody>
        {(list.data??[]).map((l:any)=><tr key={l.id}><td><div className="font-medium">{l.code} · {l.title}</div><div className="text-xs text-slate-500">#{l.id}</div></td><td>{l.status}</td><td>{l.estimatedAmount??"—"}</td><td>{l.items.length}</td></tr>)}
      </tbody></table>
    </section>
  </div>;
}
