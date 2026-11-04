"""Conservative coordinate mapping. No sequence replacement or nearest-residue guessing."""
import re

LOCATION_RE=re.compile(r'^(?:DOMAIN|ACT_SITE|BINDING|SITE)\s+(?:(?P<accession>[A-Z0-9]+(?:-\d+)?):)?(?P<start>[<>]?\d+|\?)(?:\.\.(?P<end>[<>]?\d+|\?))?(?:\s*;|$)')

def parse_location(text,default_accession=None):
 m=LOCATION_RE.match((text or '').strip())
 if not m:return {'accession':default_accession,'start':None,'end':None,'exact':False}
 a=m.group('start');b=m.group('end') or a
 exact=a.isdigit() and b.isdigit()
 return {'accession':m.group('accession') or default_accession,'start':int(a) if a.isdigit() else None,'end':int(b) if b.isdigit() else None,'exact':exact}

def occurrences(haystack,needle):
 if not needle:return []
 positions=[];i=haystack.find(needle)
 while i>=0:
  positions.append(i)
  if len(positions)>1:break
  i=haystack.find(needle,i+1)
 return positions

def map_interval(source,stored,start,end):
 if not source:return None,None,'source_sequence_unavailable'
 if not stored:return None,None,'stored_sequence_unavailable'
 if not isinstance(start,int) or not isinstance(end,int) or not (1<=start<=end<=len(source)):return None,None,'source_location_unresolved'
 if source==stored:return start,end,'identical_sequence'
 offsets=occurrences(source,stored)
 if len(offsets)==1:
  offset=offsets[0]
  if offset<start<=end<=offset+len(stored):return start-offset,end-offset,'exact_stored_fragment'
  return None,None,'outside_stored_fragment'
 # Require unique, identical local context in both sequences and exact interval sequence.
 candidates=set()
 for flank in [32,16,8]:
  lo=max(0,start-1-flank);hi=min(len(source),end+flank);anchor=source[lo:hi]
  if len(anchor)<17 or len(occurrences(source,anchor))!=1:continue
  matches=occurrences(stored,anchor)
  if len(matches)==1:candidates.add((matches[0]+start-lo,matches[0]+end-lo))
 if len(candidates)==1:
  a,b=candidates.pop()
  if stored[a-1:b]==source[start-1:end]:return a,b,'unique_exact_sequence_context'
 return None,None,'no_unique_exact_sequence_context'
