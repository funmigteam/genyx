import { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
export class ApiError extends Error {
 constructor(public statusCode:number,public code:string,message:string){super(message);}
}

// Domain services deliberately use short, user-safe messages for rejected
// operations (for example, an expired task day or an insufficient balance).
// Keeping this allow-list here prevents those expected rejections from being
// misreported as a server crash, while unknown exceptions remain redacted.
const publicOperationMessage = /^(Invalid|Unknown|Negative|Package|Previous|Season|Daily|Grace|No |Complete|Day |Task |Channel |Join |Active |Purchase |Payment |Historical |Confirmed |Register |Withdrawal |Insufficient |Idempotency |This |Only |A payout |Automated |Payout |Binary |Voucher |Ledger |Reward |Conflicting |Cannot verify |Telegram |Wallet |Account |You need |Set |Configure |Not enough |Lottery |Auction |Bid |Award |Super admin |Maximum |Game |Bot |Unsupported |Duplicate |Level |An XP boost|Open a new|Resolve pending|The operation|Reward pool)/;

export function installApiErrors(app:FastifyInstance){
 app.setErrorHandler((error,request,reply)=>{
  if(error instanceof ApiError)return reply.code(error.statusCode).send({error:error.message,code:error.code,requestId:request.id});
  if(error instanceof ZodError)return reply.code(422).send({error:'Invalid form values. Check the required fields and allowed ranges.',code:'VALIDATION_ERROR',fields:error.issues.map(i=>({path:i.path.join('.'),message:i.message})),requestId:request.id});
  const code=(error as {code?:string}).code;
  if(['P2034','P2028'].includes(code??''))return reply.code(409).send({error:'The operation was interrupted by concurrent activity or a timeout. Refresh the status before retrying.',code:'TRANSACTION_RETRY',requestId:request.id});
  if(code==='P2002')return reply.code(409).send({error:'This record already exists. Refresh before submitting again.',code:'DUPLICATE_RECORD',requestId:request.id});
  if(code==='P2025')return reply.code(404).send({error:'The requested record no longer exists. Refresh this page.',code:'NOT_FOUND',requestId:request.id});
  const httpError = error as { statusCode?: number; message?: string };
  if(httpError.statusCode&&httpError.statusCode<500)return reply.code(httpError.statusCode).send({error:httpError.message ?? 'Request failed.',requestId:request.id});
  if(error instanceof Error && publicOperationMessage.test(error.message))return reply.code(422).send({error:error.message,code:'OPERATION_REJECTED',requestId:request.id});
  request.log.error({err:error,requestId:request.id},'API operation failed');
  return reply.code(500).send({error:code==='P2021'||code==='P2022'?'The server database needs an update. Contact support.':'The server could not complete this operation. Contact support with the reference below.',code:'SERVER_ERROR',requestId:request.id});
 });
}
