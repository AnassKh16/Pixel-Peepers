// Shared pure chat filter, ready for the moderation audit module to reuse.
const dictionary=['badword','porn','scam','fuck','shit','bitch','asshole','idiotspam'];
const equivalents={a:'[a@]',o:'[o0]',i:'[i1!]',e:'[e3]',s:'[s$]'};
const separator='[_.\\-*\\u200B-\\u200D\\uFEFF]*';
const expression=new RegExp(`(?<![\\p{L}\\p{N}])(?:${dictionary.map(word=>[...word].map(char=>equivalents[char]??char).join(separator)).join('|')})(?![\\p{L}\\p{N}])`,'giu');
export function filterChatMessage(text) {
  if(/(.)\1{3,}/iu.test(text)||/!{3}|\?{3}/u.test(text))return {text:null,flagged:false,reason:'flood_character_repeat',dropped:true};
  let flagged=false;
  const filtered=text.replace(expression,()=>{flagged=true;return '***';});
  return {text:filtered,flagged,reason:flagged?'profanity_leetspeak':null,dropped:false};
}
