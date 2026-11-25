import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceAge} from '../tools/route-validator/evidence-age.mjs';
import {evidenceGroups} from '../tools/route-validator/core.mjs';
test('recency uses walking date, not upload date; historical and unknown dates cannot qualify',()=>{
 const cfg={assessmentDate:'2026-11-25',maxEvidenceAgeDays:1096};
 assert.equal(evidenceAge({parsed:{date:'2025-04-10'}},cfg).eligible,true);
 assert.equal(evidenceAge({parsed:{date:'2019-01-01'},uploadedAt:'2026-11-24'},cfg).status,'HISTORICAL_ONLY');
 assert.equal(evidenceAge({uploadedAt:'2026-11-24'},cfg).status,'UNKNOWN_DATE');
 assert.equal(evidenceAge({parsed:{date:'2027-01-01'}},cfg).status,'FUTURE_DATE');
 assert.equal(evidenceAge({parsed:{date:'2026-02-30'}},cfg).status,'UNKNOWN_DATE');
});
test('changed display names and split files from one trip remain one evidence group',()=>{
 const entry=(id,author,profile,tripId)=>({id,author,authorProfile:profile,tripId,sourceUrl:'https://example.com/'+id,sha256:id,parsed:{shapeHash:id,summary:{distanceMeters:1000+id.length*100}}});
 const groups=evidenceGroups([entry('one','作者舊名','https://example.com/author/1','trip'),entry('two-two','作者新名','https://example.com/author/1','trip'),entry('three-long','其他作者','https://example.com/author/2','other')]);
 assert.equal(groups[0].group,groups[1].group);assert.notEqual(groups[0].group,groups[2].group);
 const repost=entry('repost','轉載者','https://example.com/author/3','repost-trip');
 repost.sourceRecords=[{author:'作者原名',authorProfile:'https://example.com/author/1'}];
 assert.equal(new Set(evidenceGroups([repost,entry('original','作者新名','https://example.com/author/1','another-trip')]).map(g=>g.group)).size,1);
});
