import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEmailLink} from '../js/login.js';
import {errorMessage,initializeSupabase,signInPassword,signUpPassword,setAccountPassword,getAccount} from '../js/supabase.js';
test('email links stay on the configured auth service and return to this browser origin',()=>{
 const project='https://example.supabase.co',callback='https://learner.github.io/arabic-journey/index.html';
 const target=new URL(validateEmailLink(project+'/auth/v1/verify?token=one-time-test&type=magiclink&redirect_to=https://other.invalid',project,callback));
 assert.equal(target.searchParams.get('redirect_to'),callback);
 for(const value of ['https://attacker.invalid/auth/v1/verify?token=test&type=magiclink',project+'/wrong?token=test&type=email','javascript:alert(1)',project+'/auth/v1/verify?type=email'])assert.throws(()=>validateEmailLink(value,project,callback),/invalid_email_link/);
});
test('auth failures provide specific guidance without displaying provider secrets',()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 assert.match(errorMessage({code:'invalid_credentials'}),/Email or password/);
 assert.match(errorMessage({code:'email_not_confirmed'}),/Confirm your email/);
 assert.match(errorMessage({name:'AuthPKCEGrantCodeExchangeError'}),/browser/);
 assert.match(errorMessage({code:'email_address_not_authorized'}),/organization members/);
 assert.doesNotMatch(errorMessage({message:'private-provider-detail'}),/private-provider-detail/);
});
test('password auth delegates to Supabase, loads the owner account, and requires email confirmation',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 globalThis.localStorage={getItem:()=>null};globalThis.location={href:'https://learner.github.io/arabic-journey/index.html#/login',search:'',hash:'#/login'};
 const calls=[],user={id:'owner-test',email:'owner@example.test'};
 const auth={stopAutoRefresh(){},onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};},initialize:async()=>({}),getSession:async()=>({data:{session:null}}),
 signInWithPassword:async values=>{calls.push(values);return values.password==='wrong'?{error:{code:'invalid_credentials'}}:{data:{user}};},
 signUp:async values=>{calls.push(values);return{data:{user,session:null}};},updateUser:async values=>{calls.push(values);return{};}};
 globalThis.window={supabase:{createClient:()=>({auth,from:table=>({select(){return this;},eq(){return this;},single:async()=>({data:table==='profiles'?{display_name:'Owner'}:{ui_language:'en'}})})})},dispatchEvent(){}};
 globalThis.document={documentElement:{}};
 await initializeSupabase();await assert.rejects(signInPassword(user.email,'wrong'),e=>e.code==='invalid_credentials');
 await signInPassword(user.email,'correct-test-only');assert.equal(getAccount().user.id,user.id);
 assert.equal(await signUpPassword(user.email,'new-test-only'),false);assert.equal(calls.at(-1).options.emailRedirectTo,'https://learner.github.io/arabic-journey/index.html');
 await setAccountPassword('new-test-only');assert.deepEqual(calls.at(-1),{password:'new-test-only'});
});
