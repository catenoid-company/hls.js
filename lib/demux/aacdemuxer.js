'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      * AAC demuxer
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      */


var _adts = require('./adts');

var _adts2 = _interopRequireDefault(_adts);

var _logger = require('../utils/logger');

var _id = require('../demux/id3');

var _id2 = _interopRequireDefault(_id);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var AACDemuxer = function () {
  function AACDemuxer(observer, remuxer, config) {
    _classCallCheck(this, AACDemuxer);

    this.observer = observer;
    this.config = config;
    this.remuxer = remuxer;
  }

  _createClass(AACDemuxer, [{
    key: 'resetInitSegment',
    value: function resetInitSegment(initSegment, audioCodec, videoCodec, duration) {
      this._audioTrack = { container: 'audio/adts', type: 'audio', id: -1, sequenceNumber: 0, isAAC: true, samples: [], len: 0, manifestCodec: audioCodec, duration: duration, inputTimeScale: 90000 };
    }
  }, {
    key: 'resetTimeStamp',
    value: function resetTimeStamp() {}
  }, {
    key: 'append',


    // feed incoming data to the front of the parsing pipeline
    value: function append(data, timeOffset, contiguous, accurateTimeOffset) {
      var track = this._audioTrack,
          id3Data = _id2.default.getID3Data(data, 0),
          pts = 90 * _id2.default.getTimeStamp(id3Data),
          frameIndex = 0,
          stamp = pts,
          length = data.length,
          offset = id3Data.length;

      var id3Samples = [{ pts: stamp, dts: stamp, data: id3Data }];

      while (offset < length - 1) {
        if (_adts2.default.isHeader(data, offset) && offset + 5 < length) {
          _adts2.default.initTrackConfig(track, this.observer, data, offset, track.manifestCodec);
          var frame = _adts2.default.appendFrame(track, data, offset, pts, frameIndex);
          if (frame) {
            offset += frame.length;
            stamp = frame.sample.pts;
            frameIndex++;
          } else {
            _logger.logger.log('Unable to parse AAC frame');
            break;
          }
        } else if (_id2.default.isHeader(data, offset)) {
          id3Data = _id2.default.getID3Data(data, offset);
          id3Samples.push({ pts: stamp, dts: stamp, data: id3Data });
          offset += id3Data.length;
        } else {
          //nothing found, keep looking
          offset++;
        }
      }

      this.remuxer.remux(track, { samples: [] }, { samples: id3Samples, inputTimeScale: 90000 }, { samples: [] }, timeOffset, contiguous, accurateTimeOffset);
    }
  }, {
    key: 'destroy',
    value: function destroy() {}
  }], [{
    key: 'probe',
    value: function probe(data) {
      // check if data contains ID3 timestamp and ADTS sync word
      var offset, length;
      var id3Data = _id2.default.getID3Data(data, 0);
      if (id3Data && _id2.default.getTimeStamp(id3Data) !== undefined) {
        // Look for ADTS header | 1111 1111 | 1111 X00X | where X can be either 0 or 1
        // Layer bits (position 14 and 15) in header should be always 0 for ADTS
        // More info https://wiki.multimedia.cx/index.php?title=ADTS
        for (offset = id3Data.length, length = Math.min(data.length - 1, offset + 100); offset < length; offset++) {
          if (_adts2.default.isHeader(data, offset)) {
            //logger.log('ADTS sync word found !');
            return true;
          }
        }
      }
      return false;
    }
  }]);

  return AACDemuxer;
}();

exports.default = AACDemuxer;