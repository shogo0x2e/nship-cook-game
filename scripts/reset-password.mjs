#!/usr/bin/env node
// Operator-only recovery. Read the new password from stdin, never from argv or logs.
import { resolve } from 'node:path';
import { AccountStore } from '../server/account-store.ts';
const username=process.argv[2];
if(!username){console.error('Usage: node scripts/reset-password.mjs <username> < password-file');process.exit(1);}
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.length>2048)throw new Error('Password input too long');}
const password=input.replace(/\r?\n$/,'');
const store=new AccountStore(resolve(process.env.DATA_DIR??'data','cookgame.sqlite'));
try{await store.resetPassword(username,password);console.log('Password updated. Previous sessions have been revoked.');}finally{store.close();}
