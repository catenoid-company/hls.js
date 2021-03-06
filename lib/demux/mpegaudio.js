"use strict";

/**
 *  MPEG parser helper
 */
var MpegAudio = {

    BitratesMap: [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],

    SamplingRateMap: [44100, 48000, 32000, 22050, 24000, 16000, 11025, 12000, 8000],

    appendFrame: function appendFrame(track, data, offset, pts, frameIndex) {
        // Using http://www.datavoyage.com/mpgscript/mpeghdr.htm as a reference
        if (offset + 24 > data.length) {
            return undefined;
        }

        var header = this.parseHeader(data, offset);
        if (header && offset + header.frameLength <= data.length) {
            var frameDuration = 1152 * 90000 / header.sampleRate;
            var stamp = pts + frameIndex * frameDuration;
            var sample = { unit: data.subarray(offset, offset + header.frameLength), pts: stamp, dts: stamp };

            track.config = [];
            track.channelCount = header.channelCount;
            track.samplerate = header.sampleRate;
            track.samples.push(sample);
            track.len += header.frameLength;

            return { sample: sample, length: header.frameLength };
        }

        return undefined;
    },

    parseHeader: function parseHeader(data, offset) {
        var headerB = data[offset + 1] >> 3 & 3;
        var headerC = data[offset + 1] >> 1 & 3;
        var headerE = data[offset + 2] >> 4 & 15;
        var headerF = data[offset + 2] >> 2 & 3;
        var headerG = !!(data[offset + 2] & 2);
        if (headerB !== 1 && headerE !== 0 && headerE !== 15 && headerF !== 3) {
            var columnInBitrates = headerB === 3 ? 3 - headerC : headerC === 3 ? 3 : 4;
            var bitRate = MpegAudio.BitratesMap[columnInBitrates * 14 + headerE - 1] * 1000;
            var columnInSampleRates = headerB === 3 ? 0 : headerB === 2 ? 1 : 2;
            var sampleRate = MpegAudio.SamplingRateMap[columnInSampleRates * 3 + headerF];
            var padding = headerG ? 1 : 0;
            var channelCount = data[offset + 3] >> 6 === 3 ? 1 : 2; // If bits of channel mode are `11` then it is a single channel (Mono)
            var frameLength = headerC === 3 ? (headerB === 3 ? 12 : 6) * bitRate / sampleRate + padding << 2 : (headerB === 3 ? 144 : 72) * bitRate / sampleRate + padding | 0;

            return { sampleRate: sampleRate, channelCount: channelCount, frameLength: frameLength };
        }

        return undefined;
    },

    isHeader: function isHeader(data, offset) {
        // Look for MPEG header | 1111 1111 | 111X XYZX | where X can be either 0 or 1 and Y or Z should be 1
        // Layer bits (position 14 and 15) in header should be always different from 0 (Layer I or Layer II or Layer III)
        // More info http://www.mp3-tech.org/programmer/frame_header.html
        if (offset + 1 < data.length) {
            if (data[offset] === 0xff && (data[offset + 1] & 0xe0) === 0xe0 && (data[offset + 1] & 0x06) !== 0x00) {
                return true;
            }
        }
        return false;
    }
};

module.exports = MpegAudio;