import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../js/supabase.js';

test('browser configuration accepts public keys and rejects private credentials',()=>{
  const url = 'https://example.supabase.co';
  const anon = ['header',Buffer.from(JSON.stringify({role:'anon'})).toString('base64url'),'signature'].join('.');
  const service = ['header',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'signature'].join('.');
  assert.equal(validateConfig({url,publicKey:'sb_publishable_public_key'}).url,url);
  assert.equal(validateConfig({url,publicKey:anon}).publicKey,anon);
  for(const publicKey of ['sb_secret_private',service]) assert.throws(()=>validateConfig({url,publicKey}),/private_key/);
  for(const invalid of ['http://example.supabase.co','https://user:password@example.supabase.co','https://example.supabase.co/?token=x','https://example.supabase.co/#key'])
    assert.throws(()=>validateConfig({url:invalid,publicKey:anon}),/invalid_config/);
});
