const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./enhanced.db', err => {
  if (err) return console.error('DB error', err);
  db.run(`CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY, email TEXT, truth REAL, time_taken REAL, changes INTEGER, hover INTEGER, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','enhanced.html')));

app.post('/lie-detect', (req,res)=>{
  const { answers, timeTaken, changes, hoverUncertainty, questionTimes, consistencyScore } = req.body;
  const base = 100;
  const timePenalty = Math.min(timeTaken/20,30);
  const changePenalty = Math.min(changes*5,30);
  const patternPenalty = Math.min(analyzePattern(answers),30);
  const hoverPenalty = Math.min(hoverUncertainty*2,25);
  const consistencyBonus = Math.min(consistencyScore*10,15);
  const truth = Math.max(0, Math.min(100, base-timePenalty-changePenalty-patternPenalty-hoverPenalty+consistencyBonus));
  db.run('INSERT INTO results (email,truth,time_taken,changes,hover) VALUES (?,?,?,?,?)', ['anonymous',truth,timeTaken,changes,hoverUncertainty]);
  res.json({truth, analysis:{timePenalty,changePenalty,patternPenalty,hoverPenalty,consistencyBonus}});
});

function analyzePattern(answers){
  let alternations=0;
  for(let i=1;i<answers.length;i++) if(answers[i]!==answers[i-1]) alternations++;
  return (alternations/Math.max(1,answers.length))*20;
}

const port =process.env.PORT||3001;
app.listen(port,()=>console.log(`Enhanced server running http://localhost:${port}`));
