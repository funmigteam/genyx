import {it,expect} from 'vitest';
import {quotedTaskXp} from './xp-boost.js';
it('applies one boost after the package multiplier',()=>{expect(quotedTaskXp(20,1,false)).toBe(20);expect(quotedTaskXp(20,1,true)).toBe(40);expect(quotedTaskXp(20,2,true)).toBe(80);expect(quotedTaskXp(0,2,true)).toBe(0);});
it('rejects invalid XP amounts',()=>{expect(()=>quotedTaskXp(-1,1,true)).toThrow();expect(()=>quotedTaskXp(1,3,true)).toThrow();});
