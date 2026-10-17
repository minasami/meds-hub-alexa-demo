/** Thin wrappers around the browser Web Speech API. Everything is optional; typed input always works. */

type Rec = any;

export function speechRecognitionSupported(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listenOnce(lang: string, onInterim: (t: string) => void): { promise: Promise<string>; stop: () => void } {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const rec: Rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  const promise = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim((finalText + " " + interim).trim());
    };
    rec.onerror = (e: any) => reject(new Error(e.error || "speech recognition error"));
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { promise, stop: () => rec.stop() };
}

export function speak(text: string, lang = "en-US") {
  if (!speechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}
