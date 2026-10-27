import readline from 'node:readline';

export interface Io {
  info(message: string): void;
  warn(message: string): void;
  /** Resolves false when there is no terminal to answer the question. */
  confirm(question: string): Promise<boolean>;
}

function askQuestion(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on('close', () => {
      if (!answered) resolve(null);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

export function createConsoleIo(isAnswer: (answer: string) => boolean): Io {
  return {
    info: (message) => {
      process.stdout.write(`${message}\n`);
    },
    warn: (message) => {
      process.stderr.write(`${message}\n`);
    },
    confirm: async (question) => {
      if (!process.stdin.isTTY) return false;
      const answer = await askQuestion(question);
      return answer !== null && isAnswer(answer);
    },
  };
}
