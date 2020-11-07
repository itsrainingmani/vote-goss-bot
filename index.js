const { Octokit } = require('@octokit/rest');
const neatCsv = require('neat-csv');
const fs = require('fs').promises;
const config = require('./config.json');
require('dotenv').config();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
  userAgent: 'election-notifier v1.0.0',
  previews: ['jean-grey', 'symmetra'],
  timeZone: ['Eastern/US'],
  baseUrl: 'https://api.github.com',
  log: {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
  },
  request: {
    agent: undefined,
    fetch: undefined,
    timeout: 0,
  },
});

const twClient = require('twilio')(
  process.env.TW_ACC_SID,
  process.env.TW_AUTH_TOKEN
);

let latestCommitHash = config.currentCommitHash;
let lastStateData = '';

let numGlobalErr = 0;

// Gets a file from github and returns the base64 decoded file content
async function getFileGithub(
  commitHash,
  filename = 'battleground-state-changes.csv'
) {
  try {
    let { data } = await octokit.repos.getContent({
      owner: 'alex',
      repo: 'nyt-2020-election-scraper',
      path: filename,
      ref: commitHash,
    });

    let b64DecodedContent = Buffer.from(data.content, 'base64').toString();

    return b64DecodedContent;
  } catch (err) {
    throw new Error(err);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addCommas(rawNumber) {
  return rawNumber.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Parse the full csv file and return an object containing only the most recent updates
const getMostRecentStateData = async (data, statesToIgnore) => {
  let parsed = await neatCsv(data);
  let visited = [];
  let latest = {};

  for (let r of parsed) {
    if (!visited.includes(r.state) && !statesToIgnore.includes(r.state)) {
      visited.push(r.state);
      latest[r.state] = {
        vote_diff: r.vote_differential,
        votes_left: r.votes_remaining,
        timestamp: r.timestamp,
        in_lead: r.leading_candidate_name,
      };
    }
  }

  return latest;
};

(async () => {
  while (true) {
    console.log(`\nExecuting at ${new Date().toString()}`);

    try {
      let configFile = await fs.readFile('config.json', 'utf-8');
      let currConfig = JSON.parse(configFile);
      let recipients = currConfig.peopleToSend;
      let statesToIgnore = currConfig.statesToIgnore;
      let timeToWait = currConfig.timeToWait;

      console.log(`Recipients: ${Array.from(recipients, (x) => x.name)}`);
      console.log(`Ignoring ${statesToIgnore}`);

      // Get a list of commits from the repo for the csv file path
      let { data } = await octokit.repos.listCommits({
        owner: 'alex',
        repo: 'nyt-2020-election-scraper',
        path: 'battleground-state-changes.csv',
      });
      let commitHashes = data.map((x) => x.sha);

      // If there is no commit that has any new data, move on
      if (commitHashes.length === 0 || commitHashes[0] === latestCommitHash) {
        console.log('No New Commits for State Data');
      } else {
        console.log(
          `Setting the new Commit Hash from ${latestCommitHash.slice(
            0,
            9
          )} to ${commitHashes[0].slice(0, 9)}`
        );

        // Update our commit hash with the most recent commit that matches from the repo
        latestCommitHash = commitHashes[0];

        console.log('There is new data!');
        let updatedData = await getFileGithub(latestCommitHash);
        let parsedData = await getMostRecentStateData(
          updatedData,
          statesToIgnore
        );

        let stateTxtMsgs = [];
        console.log(parsedData);

        // First time running the program
        if (lastStateData === '') {
          for (let k of Object.keys(parsedData)) {
            let currVoteDiff = parsedData[k];
            let magnitude = currVoteDiff.in_lead === 'Biden' ? '+' : '-';

            let voteDiffFormatted = addCommas(currVoteDiff.vote_diff);
            let voteLeftFormatted = addCommas(currVoteDiff.votes_left);

            if (parseInt(currVoteDiff.votes_left) < 0) {
              voteLeftFormatted = '~';
            }

            stateTxtMsgs.push(
              `${k} has a ${magnitude}${voteDiffFormatted} margin with ${voteLeftFormatted} votes left`
            );
          }
        } else {
          for (let k of Object.keys(parsedData)) {
            let voteDirection = '';
            let currVoteData = parsedData[k];
            let oldVoteData = lastStateData[k];

            let magnitude = currVoteData.in_lead === 'Biden' ? '+' : '-';

            let currVoteDiff = parseInt(currVoteData.vote_diff);
            let oldVoteDiff = parseInt(oldVoteData.vote_diff);

            // Gives visual indication of direction of change in margin
            if (currVoteDiff < oldVoteDiff) {
              voteDirection = '⬇️';
            } else if (currVoteDiff > oldVoteDiff) {
              voteDirection = '⬆️';
            } else if (currVoteDiff == oldVoteDiff) {
              voteDirection = '';
            }

            let voteDiffFormatted = addCommas(currVoteData.vote_diff);
            let voteLeftFormatted = addCommas(currVoteData.votes_left);

            if (parseInt(currVoteData.votes_left) < 0) {
              voteLeftFormatted = '~';
            }

            stateTxtMsgs.push(
              `${k}${voteDirection} has a ${magnitude}${voteDiffFormatted} margin with ${voteLeftFormatted} votes left`
            );
          }
        }

        lastStateData = parsedData;

        let messageToSend = stateTxtMsgs.join('\n\n');

        // Loop through list of people and send the parsed data to them
        for (let recipient of recipients) {
          try {
            let msg = await twClient.messages.create({
              body: `Hey ${recipient.name}, \n\n${messageToSend}`,
              from: config.twilioPhone,
              to: recipient.num,
            });
            console.log(`Message sent to ${recipient.name}`);
          } catch (err) {
            console.log(`SMS Error: ${err}`);
            continue;
          }
        }
      }

      await delay(timeToWait);
    } catch (err) {
      console.warn(`Weee Woooo: Error ${err}`);

      numGlobalErr++;

      if (numGlobalErr > 3) {
        console.log('NUMBER OF GLOBAL ERRORS IS MORE THAN 3. GET IT TOGETHER');
        process.exit();
      }
    }
  }
})();
