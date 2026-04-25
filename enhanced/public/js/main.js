const questionsPool = [
  {id:1,text:"Do you always tell the truth in your daily interactions?"},
  {id:2,text:"Have you ever exaggerated the truth to impress someone?"},
  {id:3,text:"Do you feel nervous when being questioned about your honesty?"},
  {id:4,text:"Can you confidently say you've never told a significant lie?"},
  {id:5,text:"Do you hesitate before answering direct personal questions?"},
  {id:6,text:"Have you lied to avoid getting into trouble?"},
  {id:7,text:"Do you feel uncomfortable when someone doesn't believe you?"},
  {id:8,text:"Can you maintain eye contact while discussing controversial topics?"},
  {id:9,text:"Do you believe honesty is always the best policy?"},
  {id:10,text:"Have you ever regretted telling the truth?"},
  {id:11,text:"Do you find yourself withholding opinions in group settings?"},
  {id:12,text:"Have you ever told a lie to protect someone else?"}
];

const QUESTIONS_PER_SESSION = 8;
let questionSet = [];
let current = 0;
let answers = [];
let changes = 0;
let hoverUncertainty = 0;
let consistencyScore = 1;
let questionTimes = [];
let startTime = Date.now();
let questionStart = Date.now();
let hoverTimeout;

const qElement = document.getElementById('q');
const qCount = document.getElementById('qcount');
const nextBtn = document.getElementById('nextBtn');
const yesBtn = document.getElementById('yesBtn');
const noBtn = document.getElementById('noBtn');
const feedbackBox = document.getElementById('questionFeedback');
const meterText = document.getElementById('liveTruth');
const liveMeter = document.getElementById('liveMeter');

function shuffle(a){return a.sort(()=>Math.random()-0.5);} 

function pickQuestions(){const unseen=questionsPool.filter(q=>!JSON.parse(localStorage.getItem('seenQuestions')||'[]').includes(q.id));
  if(unseen.length<QUESTIONS_PER_SESSION) localStorage.removeItem('seenQuestions');
  const source=unseen.length?unseen:questionsPool;
  const chosen=shuffle(source).slice(0,QUESTIONS_PER_SESSION);
  localStorage.setItem('seenQuestions', JSON.stringify([...new Set([...(JSON.parse(localStorage.getItem('seenQuestions')||'[]')), ...chosen.map(q=>q.id)])].slice(-QUESTIONS_PER_SESSION)));
  return chosen;
}

function init(){questionSet=pickQuestions();current=0;answers=[];changes=0;hoverUncertainty=0;consistencyScore=1;questionTimes=[];startTime=Date.now();questionStart=Date.now();renderQuestion();}

function renderQuestion(){if(current>=questionSet.length){submit();return;}qElement.innerText=questionSet[current].text;qCount.innerText=`Question ${current+1} of ${questionSet.length}`;
  setProgress((current)/questionSet.length);
  yesBtn.classList.remove('selected');noBtn.classList.remove('selected');
  feedbackBox.classList.remove('visible');

  yesBtn.onmouseover=onHesitation;
  noBtn.onmouseover=onHesitation;
  yesBtn.onmouseout=clearHesitation;
  noBtn.onmouseout=clearHesitation;
}

function setProgress(p){document.getElementById('progressFill').style.width=`${p*100}%`;}

function onHesitation(){if(feedbackBox.dataset.shown==='true') return;clearTimeout(hoverTimeout);hoverTimeout=setTimeout(()=>{feedbackBox.innerText='😟 Hover hesitation detected';feedbackBox.classList.add('visible');feedbackBox.dataset.shown='true';hoverUncertainty++;setTimeout(()=>{feedbackBox.classList.remove('visible')},900);},800);}

function clearHesitation(){clearTimeout(hoverTimeout);}

function selectAnswer(val){if(!questionSet[current]) return; if(answers[current] && answers[current]!==val) changes++; answers[current]=val;yesBtn.classList.remove('selected');noBtn.classList.remove('selected');(val==='yes'?yesBtn:noBtn).classList.add('selected');}

yesBtn.addEventListener('click',()=>selectAnswer('yes'));
noBtn.addEventListener('click',()=>selectAnswer('no'));
nextBtn.addEventListener('click',()=>{if(!answers[current]) return;const qTime=(Date.now()-questionStart)/1000;questionTimes.push(qTime);questionStart=Date.now();if(answers.length>1){const lastTwo=[answers[current-1],answers[current]];consistencyScore+=lastTwo[0]===lastTwo[1]?0.1:-0.05;consistencyScore=Math.max(0,Math.min(1,consistencyScore));}current++;updateLive();setTimeout(()=>renderQuestion(),200);});

function updateLive(){const avgTime=questionTimes.length?questionTimes.reduce((a,b)=>a+b,0)/questionTimes.length:0;const ht=Math.min(hoverUncertainty*2,25);const score=Math.max(0,Math.min(100,100-(avgTime*2)-(changes*5)-ht+(consistencyScore*20)));meterText.innerText=`${Math.round(score)}%`;liveMeter.style.width=`${score}%`;}

function submit(){const timeTaken=(Date.now()-startTime)/1000;const payload={answers, timeTaken, changes, hoverUncertainty, questionTimes, consistencyScore};fetch('/lie-detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json()).then(data=>{document.getElementById('resultContainer').style.display='block';document.getElementById('resultContainer').innerHTML=`<div class='result-analysis'><h4>Final ${Math.round(data.truth)}%</h4><ul><li>time: ${Math.round(timeTaken)}s</li><li>hover penalty: ${data.analysis.hoverPenalty}%</li><li>formula: 100 - time - changes - pattern - hover + consistency</li></ul></div>`;});}

init();