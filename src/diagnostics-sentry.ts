import { init, captureEvent, captureException } from '@sentry/browser';
import { diagnosticErrorKind, diagnosticMessages, sanitizeDiagnostic, type DiagnosticContext, type DiagnosticCode, type DiagnosticMetrics, type DeviceDiagnosticContext } from './diagnostics-policy';

export function configureDiagnosticSender(dsn:string,release:string,origin:string,device:DeviceDiagnosticContext,getContext:()=>DiagnosticContext){
  init({dsn,release,defaultIntegrations:false,integrations:[],sendClientReports:false,maxBreadcrumbs:0,
    dataCollection:{userInfo:false,cookies:false,httpHeaders:false,httpBodies:[],urlQueryParams:false,graphQL:{document:false,variables:false},genAI:{inputs:false,outputs:false},mcp:{inputs:false,outputs:false},databaseQueryData:false,queues:false,stackFrameVariables:false,frameContextLines:0},
    beforeSend:event=>sanitizeDiagnostic(event,{
      experienceId:String(event.tags?.experience_id??''),deviceId:String(event.tags?.browser_id??''),screen:String(event.tags?.screen??''),demo:event.tags?.demo===true,
    },device,release,origin),
  });
  return (code:DiagnosticCode,error:unknown,metrics:DiagnosticMetrics)=>{
    const context=getContext();
    const event={message:diagnosticMessages[code],tags:{diagnostic_code:code,error_kind:diagnosticErrorKind(error),experience_id:context.experienceId,browser_id:context.deviceId,screen:context.screen,demo:context.demo},contexts:{diagnostics:metrics}};
    if(error instanceof Error)captureException(error,event);else captureEvent(event);
  };
}
