export function interfaceAsset(api,name){
  const vector=name.endsWith('.svg');
  return api.package.url('images/'+(vector?name:name+'.png'),vector?'image/svg+xml':'image/png');
}
