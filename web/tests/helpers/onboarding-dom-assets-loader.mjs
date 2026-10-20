// Behavior-only DOM fixture: CSS and Vite's image URL glob do not execute in Node.
// This does not replace the separate browser visual acceptance checks.
export async function load(url,context,nextLoad){
 if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true}
 const result=await nextLoad(url,context)
 if(url.includes('/data/catalogs/voices.ts'))return {...result,source:String(result.source).replace(/import\.meta\.glob(?:<string>)?\([^)]*\)/g,'({})')}
 return result
}
