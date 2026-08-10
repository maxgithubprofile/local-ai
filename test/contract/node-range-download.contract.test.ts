import { NodeRangeDownloadAdapter } from '../../src/adapters/node-testing/node-range-download.adapter.js';
import { defineDownloadTransportContract } from './download-transport.contract.js';

defineDownloadTransportContract(() => new NodeRangeDownloadAdapter());
