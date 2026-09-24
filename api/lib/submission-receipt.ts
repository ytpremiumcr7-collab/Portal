import { randomUUID } from "node:crypto";
import { submissionReceipts } from "@db/schema-eproc";
import { hashSubmissionReceipt } from "./eproc-core";

export async function createSubmissionReceipt(tx:any,input:{
  tenantId:number;licitacionId:number;lotId:number;participacionId:number;proposicionId:number;
  proveedorId:number;supplierOrganizationId:number;submittedByUserId:number;supplierMembershipId:number;
  actingAuthorityId:number;authoritySnapshot:unknown;receiptType:"SUBMISSION"|"WITHDRAWAL"|"REPLACEMENT";
  manifestHash:string;sealHash:string;ciphertextHash:string;submissionVersion:number;
  supersedesProposicionId?:number|null;serverReceivedAt:Date;
}){
  const receiptCode=`RCP-${randomUUID()}`;
  const receiptHash=hashSubmissionReceipt({
    tenantId:input.tenantId,procedureId:input.licitacionId,submissionId:input.proposicionId,
    supplierOrganizationId:input.supplierOrganizationId,submittedByUserId:input.submittedByUserId,
    actingAuthorityId:input.actingAuthorityId,manifestHash:input.manifestHash,
    serverReceivedAt:input.serverReceivedAt.toISOString(),submissionVersion:input.submissionVersion,
    supersedesSubmissionId:input.supersedesProposicionId??null,receiptType:input.receiptType,
  });
  const result=await tx.insert(submissionReceipts).values({
    tenantId:input.tenantId,receiptCode,schemaVersion:1,algorithm:"SHA256",
    licitacionId:input.licitacionId,lotId:input.lotId,participacionId:input.participacionId,
    proposicionId:input.proposicionId,proveedorId:input.proveedorId,
    supplierOrganizationId:input.supplierOrganizationId,submittedByUserId:input.submittedByUserId,
    supplierMembershipId:input.supplierMembershipId,actingAuthorityId:input.actingAuthorityId,
    authoritySnapshot:input.authoritySnapshot,sealHash:input.sealHash,ciphertextHash:input.ciphertextHash,
    receiptType:input.receiptType,manifestHash:input.manifestHash,submissionVersion:input.submissionVersion,
    supersedesProposicionId:input.supersedesProposicionId??null,serverReceivedAt:input.serverReceivedAt,
    receiptHash,timestampStatus:"PENDING_EXTERNAL",
  } as any);
  return {id:Number(result[0].insertId),receiptCode,receiptHash,timestampStatus:"PENDING_EXTERNAL" as const};
}
