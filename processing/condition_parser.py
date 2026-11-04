import re

NUMBER=r'(-?\d+(?:\.\d+)?)'
PH=re.compile(r'\bpH\s*(?:=|:)?\s*'+NUMBER,re.I)
TEMP=re.compile(NUMBER+r'\s*(?:degrees?\s+Celsius|°\s*C\b|deg\.?\s*C\b)',re.I)
RANGE=re.compile(r'(?:\d\s*(?:[-–—]|to)\s*$|between\s+[^;()]{0,25}$)',re.I)

def parse_direct_conditions(text):
    """Read only explicit scalar assay context; never infer optimum or ranges."""
    text=text or ''
    if re.search(r'\b(?:optimum|optimal|cultivat\w*|growth|expression\s+temperature)\b',text,re.I):
        return {'ph':None,'temperature':None,'status':'non_assay_or_optimum_context_held'}
    output={};held=[]
    for field,regex,bounds in [('ph',PH,(0,14)),('temperature',TEMP,(-273.15,200))]:
        values=[];ambiguous=False
        for match in regex.finditer(text):
            prefix=text[max(0,match.start()-35):match.start()]
            suffix=text[match.end():match.end()+20]
            if RANGE.search(prefix) or re.match(r'\s*(?:[-–—]|to)\s*\d',suffix,re.I):ambiguous=True
            value=float(match.group(1))
            if not bounds[0]<=value<=bounds[1]:ambiguous=True
            values.append(value)
        unique=set(values)
        output[field]=next(iter(unique)) if len(unique)==1 and not ambiguous else None
        if values and output[field] is None:held.append(field)
    output['status']='explicit_source_row_scalar_conditions' if any(output.values()) else 'no_unambiguous_scalar_conditions'
    output['held_fields']=held
    return output
