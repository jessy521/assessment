import { BadRequestException, Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer-extra';
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
import { Review, ReviewData } from './reviews.interface';
import { userAgents } from 'src/utils/utils';
import * as CDP from 'chrome-remote-interface';
import { ReviewQueryDto } from './review.dto';
const chromeLauncher = require('chrome-launcher');

puppeteer.use(StealthPlugin());

@Injectable()
export class ReviewsService {
  async getReviews(dto: ReviewQueryDto): Promise<ReviewData> {
    if (!dto.business || !dto.method) {
      throw new BadRequestException(
        'Missing required query parameters: business and method',
      );
    }
    if (!['puppeteer', 'chrome-remote-interface'].includes(dto.method)) {
      throw new BadRequestException(
        'Invalid method. Allowed values are puppeteer and chrome-remote-interface',
      );
    }
    if (dto.method === 'puppeteer') {
      return await this.scrapeReviews(dto.business);
    }
    return await this.scrapeReviewsWithCRI(dto.business);
  }

  async scrapeReviews(business: string): Promise<ReviewData> {
    const browser = await puppeteer.launch({
      headless: true, //NOTE: Set to false to see the browser in action
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    const randomUserAgent =
      userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(randomUserAgent);

    const client = await page.target().createCDPSession();
    await client.send('Network.enable');
    await client.send('Page.enable');

    try {
      const url = `https://www.google.com/maps/search/${encodeURIComponent(business)}`;
      console.log(`Navigating to: ${url}`);

      await page.goto(url, { waitUntil: 'networkidle2' });

      await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 15000 });
      await page.click('a[href*="/maps/place/"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      await page.waitForSelector('button[aria-label*="More reviews"]', {
        timeout: 15000,
      });

      await page.click('button[aria-label*="More reviews"]');
      await page.waitForSelector('div[role="main"]', { timeout: 15000 });

      const scrollableContainerSelector =
        '#QA0Szd > div > div > div.w6VYqd > div.bJzME.Hu9e2e.tTVLSc > div > div.e07Vkf.kA9KIf > div > div > div.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde';

      await page.waitForSelector(scrollableContainerSelector, {
        timeout: 20000,
      });
      const scrollableContainer = await page.$(scrollableContainerSelector);

      if (!scrollableContainer) {
        console.error('Could not find the scrollable container.');
        return {
          averageRating: 0,
          totalReviews: 0,
          latestReviews: [],
          error: 'Failed to find the reviews section on Google Maps',
        };
      }

      const containerBox = await scrollableContainer.boundingBox();
      if (containerBox) {
        await page.mouse.move(
          containerBox.x + containerBox.width / 2,
          containerBox.y + containerBox.height / 2,
        );
      }

      await scrollableContainer.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await page.keyboard.press('ArrowDown');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      let previousReviewCount = 0;
      let attempts = 0;
      const maxAttempts = 100;
      const scrollPauseTime = 2000;

      while (attempts < maxAttempts) {
        const currentReviewCount = await page.evaluate(() => {
          return document.querySelectorAll('.jftiEf').length;
        });

        console.log(
          `Scroll attempt ${attempts + 1}: Loaded ${currentReviewCount} reviews`,
        );

        if (currentReviewCount === 50) {
          console.log('No new reviews loaded, stopping scrolling.');
          break;
        }

        previousReviewCount = currentReviewCount;

        await page.evaluate((selector) => {
          const container = document.querySelector(selector) as HTMLElement;
          if (container) {
            container.scrollBy(0, 500);
          }
        }, scrollableContainerSelector);
        await page.keyboard.press('ArrowDown');

        await new Promise((resolve) => setTimeout(resolve, scrollPauseTime));

        attempts++;
      }

      console.log(`Total reviews loaded: ${previousReviewCount}`);

      console.log('Extracting review data...');

      const reviewData = await page.evaluate(() => {
        const getText = (selector: string) =>
          document.querySelector(selector)?.textContent?.trim() || '';

        const averageRating = parseFloat(
          document.querySelector('div.fontDisplayLarge')?.textContent?.trim() ||
            '0',
        );

        const totalReviews = parseInt(
          document
            .querySelector('div.jANrlb > div.fontBodySmall')
            ?.textContent?.replace('reviews', '')
            .trim()
            .replace(',', '') || '0',
        );

        const reviews: Review[] = [];

        document.querySelectorAll('.jftiEf').forEach((review) => {
          const username =
            review.querySelector('.d4r55')?.textContent?.trim() || 'Unknown';
          const datetime =
            review.querySelector('.rsqaWe')?.textContent?.trim() || '';

          const ratingElement = review.querySelector(
            'span[aria-label*="stars"]',
          );
          const rating = ratingElement
            ? parseFloat(
                ratingElement
                  .getAttribute('aria-label')
                  ?.match(/\d+(\.\d+)?/)?.[0] || '0',
              )
            : 0;

          const body =
            review.querySelector('.wiI7pd')?.textContent?.trim() || '';

          reviews.push({ username, datetime, rating, body });
        });

        return {
          averageRating,
          totalReviews,
          latestReviews: reviews.slice(0, 50),
        };
      });

      return reviewData;
    } catch (error) {
      console.error('Error scraping reviews:', error);
      return {
        averageRating: 0,
        totalReviews: 0,
        latestReviews: [],
        error: 'Failed to retrieve reviews',
      };
    } finally {
      await browser.close();
    }
  }

  // chrome-remote-interface (CRI) method
  async scrapeReviewsWithCRI(business: string) {
    let client: CDP.Client | null = null;
    const chrome = await chromeLauncher.launch({
      chromeFlags: [
        '--headless', //NOTE: remove this see the browser in action
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    try {
      client = await CDP({ port: chrome.port });
      const { Page, Runtime, Network, Input } = client;

      await Promise.all([Page.enable(), Network.enable()]);

      await Network.setBypassServiceWorker({ bypass: true });

      const url = `https://www.google.com/maps/search/${encodeURIComponent(business)}`;
      console.log(`Navigating to: ${url}`);
      await Page.navigate({ url });
      await this.waitForNetworkIdle(client, 5000);
      await client.send('Page.bringToFront');

      const businessLinkSelector = 'a[href*="/maps/place/"]';
      await this.waitForSelector(client, businessLinkSelector, 15000);

      await Runtime.evaluate({
        expression: `document.querySelector('${businessLinkSelector}').click();`,
      });
      await this.waitForNetworkIdle(client, 3000);

      const moreReviewsSelector = 'button[aria-label*="More reviews"]';
      await this.waitForSelector(client, moreReviewsSelector, 15000);

      await Runtime.evaluate({
        expression: `document.querySelector('${moreReviewsSelector}').click();`,
      });
      await this.waitForNetworkIdle(client, 3000);

      const scrollableContainerSelector =
        '#QA0Szd > div > div > div.w6VYqd > div.bJzME.Hu9e2e.tTVLSc > div > div.e07Vkf.kA9KIf > div > div > div.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde';
      await this.waitForSelector(client, scrollableContainerSelector, 20000);

      await this.focusScrollableContainer(client, scrollableContainerSelector);
      await this.scrollReviews(client, scrollableContainerSelector);

      const { result } = await Runtime.evaluate({
        expression: `
        (function() {
          const averageRating = parseFloat(
            document.querySelector('div.fontDisplayLarge')?.textContent?.trim() || '0'
          );

          const totalReviews = parseInt(
            document.querySelector('div.jANrlb > div.fontBodySmall')
              ?.textContent?.replace('reviews', '').trim().replace(',', '') || '0',
            10
          );

          const reviews = [];
          document.querySelectorAll('.jftiEf').forEach((review) => {
            const username = review.querySelector('.d4r55')?.textContent?.trim() || 'Unknown';
            const datetime = review.querySelector('.rsqaWe')?.textContent?.trim() || '';

            const ratingElement = review.querySelector('span[aria-label*="stars"]');
            const rating = ratingElement
              ? parseFloat(
                  ratingElement.getAttribute('aria-label')?.match(/\\d+(\\.\\d+)?/)?.[0] || '0'
                )
              : 0;

            const body = review.querySelector('.wiI7pd')?.textContent?.trim() || '';

            reviews.push({ username, datetime, rating, body });
          });

          return {
            averageRating,
            totalReviews,
            latestReviews: reviews.slice(0, 50)
          };
        })()
      `,
        returnByValue: true,
      });

      console.log('Extracted review data:', result.value);
      return result.value;
    } catch (error) {
      console.error('Error scraping reviews:', error);
      return {
        averageRating: 0,
        totalReviews: 0,
        latestReviews: [],
        error: 'Failed to retrieve reviews',
      };
    } finally {
      await client.close();
      await chrome.kill();
      console.log('Closed separate Chrome instance.');
    }
  }

  async simulateHumanBehavior(client: CDP.Client) {
    const { Runtime, Input } = client;

    console.log('Simulating simple human behavior: hovers & scrolls');

    const numberOfActions = this.getRandomInt(3, 6); // Number of total actions to perform

    for (let i = 0; i < numberOfActions; i++) {
      const randomX = this.getRandomInt(100, 1000);
      const randomY = this.getRandomInt(100, 800);

      await Input.dispatchMouseEvent({
        type: 'mouseMoved',
        x: randomX,
        y: randomY,
      });

      const hoverPause = this.getRandomInt(500, 1500);
      console.log(`Hovering for ${hoverPause}ms...`);
      await this.delay(hoverPause);

      const scrollAmount = this.getRandomInt(100, 500);
      const scrollDirection = Math.random() > 0.5 ? 1 : -1;

      console.log(`Scrolling window by ${scrollAmount * scrollDirection}px`);

      await Runtime.evaluate({
        expression: `window.scrollBy(0, ${scrollAmount * scrollDirection});`,
      });

      const actionPause = this.getRandomInt(800, 2000);
      console.log(`Waiting ${actionPause}ms before next action...`);
      await this.delay(actionPause);
    }

    console.log('Finished simulating simple human behavior.');
  }

  async scrollReviews(client: CDP.Client, containerSelector: string) {
    const { Runtime, Input } = client;

    let previousCount = 0;
    let currentCount = 0;
    let attempts = 0;
    const maxAttempts = 100;

    console.log(
      `Starting human-like review scrolling on container: ${containerSelector}`,
    );

    while (attempts < maxAttempts) {
      const { result: reviewCountResult } = await Runtime.evaluate({
        expression: `document.querySelectorAll('.jftiEf').length`,
        returnByValue: true,
      });

      currentCount = reviewCountResult.value;
      console.log(
        `Scroll attempt ${attempts + 1}: Loaded ${currentCount} reviews`,
      );

      if (currentCount >= 50) {
        console.log('Reached target of 50 reviews.');
        break;
      }

      previousCount = currentCount;
      attempts++;

      await Runtime.evaluate({
        expression: `
          (function() {
            const container = document.querySelector('${containerSelector}');
            if (container) {
              container.scrollBy(0, 500);
            }
          })();
        `,
      });

      await this.delay(this.getRandomInt(800, 1500));
    }

    console.log(
      `Finished scrolling reviews after ${attempts} attempts. Final count: ${currentCount}`,
    );
  }

  async waitForSelector(
    client: CDP.Client,
    selector: string,
    timeout: number = 10000,
  ) {
    const { Runtime } = client;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const { result } = await Runtime.evaluate({
        expression: `document.querySelector('${selector}') !== null`,
        returnByValue: true,
      });

      if (result.value) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Selector "${selector}" not found within ${timeout}ms`);
  }

  async waitForNetworkIdle(client: CDP.Client, idleTime: number = 500) {
    const { Network } = client;
    let lastActivity = Date.now();
    let isIdle = false;

    Network.requestWillBeSent(() => {
      lastActivity = Date.now();
      isIdle = false;
    });

    Network.loadingFinished(() => {
      lastActivity = Date.now();
      isIdle = false;
    });

    while (!isIdle) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (Date.now() - lastActivity >= idleTime) {
        isIdle = true;
      }
    }
  }

  delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async focusScrollableContainer(
    client: CDP.Client,
    containerSelector: string,
  ) {
    const { Runtime, Input } = client;

    const { result: containerBox } = await Runtime.evaluate({
      expression: `
      (function() {
        const el = document.querySelector('${containerSelector}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      })();
    `,
      returnByValue: true,
    });

    if (!containerBox.value) {
      console.error('Could not find the scrollable container.');
      return false;
    }

    const centerX = containerBox.value.x + containerBox.value.width / 2;
    const centerY = containerBox.value.y + containerBox.value.height / 2;

    console.log(
      `Moving mouse to center of container: (${centerX}, ${centerY})`,
    );

    await Input.dispatchMouseEvent({
      type: 'mouseMoved',
      x: centerX,
      y: centerY,
    });

    await this.delay(300);

    await Input.dispatchMouseEvent({
      type: 'mousePressed',
      button: 'left',
      x: containerBox.value.x,
      y: containerBox.value.y,
      clickCount: 1,
    });

    await Input.dispatchMouseEvent({
      type: 'mouseReleased',
      button: 'left',
      x: containerBox.value.x,
      y: containerBox.value.y,
    });

    await this.delay(500);

    await Input.dispatchKeyEvent({
      type: 'keyDown',
      windowsVirtualKeyCode: 40,
    });

    await Input.dispatchKeyEvent({
      type: 'keyUp',
      windowsVirtualKeyCode: 40,
    });

    console.log('Sent ArrowDown key to trigger scrolling.');

    return true;
  }
}
