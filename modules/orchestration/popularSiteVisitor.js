import { DatabaseHelper } from "../database/databaseHelper.js";
import { NavigationHelper } from "../navigation/navigationHelper.js";
import { parentPort, workerData } from "worker_threads";
import moment from "moment";


class Queue {
  constructor() {
      this.items = [];
      this.processing = false;
  }

  enqueue(item) {
      this.items.push(item);
      console.log(`[${moment().format("DD.MM.YYYY HH:MM:SS")}] Queued ${item.domainAddress}. Queue size: '${this.items.length}'`);
      this.processNext();
  }

  async processNext() {
      if (this.processing || this.items.length === 0) return;
      this.processing = true;
      const message = this.items.shift();
      try {
          console.log(`[${moment().format("DD.MM.YYYY HH:MM:SS")}] Processing ${message.domainAddress}. Queue size: '${this.items.length}'`);
          const data = await visitOneSite(message);
          parentPort.postMessage(data);
      } catch (error) {
          console.error(error);
      } finally {
          this.processing = false;
          this.processNext();
      }
  }
}

const queue = new Queue();

function isIterable(obj) {
  // checks for null and undefined
  if (obj == null) { 
    return false;
  }
  return typeof obj[Symbol.iterator] === 'function';
}

async function visitOneSite(site) {
  const navigation = new NavigationHelper();
  const database = new DatabaseHelper(workerData.mongoURI);
  await database.initializeConnectionAndOpenDatabase(workerData.databaseName);

  if (site.domainAddress) {
    try {
      const siteVisit = await navigation.visitPageAndInterceptURLs(site.domainAddress);

      if (siteVisit.cookies) {
        const foundSite = await database.findOneRecordById( site._id, workerData.popularSiteCollectionName );
        await database.updateSiteCookies( workerData.popularSiteCollectionName, foundSite, siteVisit.cookies );
      }

      if (siteVisit.localStorage) {
        const foundSite = await database.findOneRecordById( site._id, workerData.popularSiteCollectionName );
        await database.updateSiteLocalStorage( workerData.popularSiteCollectionName, foundSite, siteVisit.localStorage );
      }

      if (siteVisit.frames) {
        const foundSite = await database.findOneRecordById( site._id, workerData.popularSiteCollectionName );
        await database.updateSiteFrames( workerData.popularSiteCollectionName, foundSite, siteVisit.frames );
      }

      if (siteVisit.canvasFingerprintingDetected) {
        await database.setSiteCanvasFingerprinting( workerData.popularSiteCollectionName, site);
      }

      if (isIterable(siteVisit.requests)) {
        for (const requestFromSite of siteVisit.requests) {
          await database.upsertTrackerToDatabse( workerData.trackerCollectionName, site, requestFromSite );
        }
      }

      return await database.getOneSitesWithRequestsAndOwners( site._id, workerData.popularSiteCollectionName, workerData.trackerCollectionName, workerData.siteOwnersCollectionName );
    } catch (error) {
      console.error(error);
    }
  } 
}

parentPort.on("message", (message) => {
  if (message.domainAddress) {
    queue.enqueue(message);
  }
});
