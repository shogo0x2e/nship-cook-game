export const freshParticipant = () => ({ age: '' });
export const isYoung = participant => participant.age !== '' && Number(participant.age) <= 8;
export function restoreParticipant(value) {
  return { age: /^\d{1,3}$/.test(String(value?.age ?? '')) && Number(value.age) <= 120 ? String(value.age) : '' };
}
export const participantComplete = participant => /^\d{1,3}$/.test(String(participant.age)) && Number(participant.age) <= 120;
export function participantFields(participant) {
  return `<fieldset class="respondent-fields age-only"><legend>体験するお子さんについて</legend>
    <label>現在の年齢（歳）<input type="number" name="age" min="0" max="120" step="1" inputmode="numeric" required value="${participant.age}" autocomplete="off"></label>
    <p>年齢に合わせて、アンケートの言葉を切り替えます。</p></fieldset>`;
}
