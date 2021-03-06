'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     * fMP4 remuxer
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     */

var _aac = require('../helper/aac');

var _aac2 = _interopRequireDefault(_aac);

var _events = require('../events');

var _events2 = _interopRequireDefault(_events);

var _logger = require('../utils/logger');

var _mp4Generator = require('../remux/mp4-generator');

var _mp4Generator2 = _interopRequireDefault(_mp4Generator);

var _errors = require('../errors');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// 10 seconds
var MAX_SILENT_FRAME_DURATION = 10 * 1000;

var MP4Remuxer = function () {
  function MP4Remuxer(observer, config, typeSupported, vendor) {
    _classCallCheck(this, MP4Remuxer);

    this.observer = observer;
    this.config = config;
    this.typeSupported = typeSupported;
    var userAgent = navigator.userAgent;
    this.isSafari = vendor && vendor.indexOf('Apple') > -1 && userAgent && !userAgent.match('CriOS');
    this.ISGenerated = false;
  }

  _createClass(MP4Remuxer, [{
    key: 'destroy',
    value: function destroy() {}
  }, {
    key: 'resetTimeStamp',
    value: function resetTimeStamp(defaultTimeStamp) {
      this._initPTS = this._initDTS = defaultTimeStamp;
    }
  }, {
    key: 'resetInitSegment',
    value: function resetInitSegment() {
      this.ISGenerated = false;
    }
  }, {
    key: 'remux',
    value: function remux(audioTrack, videoTrack, id3Track, textTrack, timeOffset, contiguous, accurateTimeOffset) {
      // generate Init Segment if needed
      if (!this.ISGenerated) {
        this.generateIS(audioTrack, videoTrack, timeOffset);
      }

      if (this.ISGenerated) {
        // Purposefully remuxing audio before video, so that remuxVideo can use nextAudioPts, which is
        // calculated in remuxAudio.
        //logger.log('nb AAC samples:' + audioTrack.samples.length);
        if (audioTrack.samples.length) {
          // if initSegment was generated without video samples, regenerate it again
          if (!audioTrack.timescale) {
            _logger.logger.warn('regenerate InitSegment as audio detected');
            this.generateIS(audioTrack, videoTrack, timeOffset);
          }
          var audioData = this.remuxAudio(audioTrack, timeOffset, contiguous, accurateTimeOffset);
          //logger.log('nb AVC samples:' + videoTrack.samples.length);
          if (videoTrack.samples.length) {
            var audioTrackLength = void 0;
            if (audioData) {
              audioTrackLength = audioData.endPTS - audioData.startPTS;
            }
            // if initSegment was generated without video samples, regenerate it again
            if (!videoTrack.timescale) {
              _logger.logger.warn('regenerate InitSegment as video detected');
              this.generateIS(audioTrack, videoTrack, timeOffset);
            }
            this.remuxVideo(videoTrack, timeOffset, contiguous, audioTrackLength, accurateTimeOffset);
          }
        } else {
          var videoData = void 0;
          //logger.log('nb AVC samples:' + videoTrack.samples.length);
          if (videoTrack.samples.length) {
            videoData = this.remuxVideo(videoTrack, timeOffset, contiguous, accurateTimeOffset);
          }
          if (videoData && audioTrack.codec) {
            this.remuxEmptyAudio(audioTrack, timeOffset, contiguous, videoData);
          }
        }
      }
      //logger.log('nb ID3 samples:' + audioTrack.samples.length);
      if (id3Track.samples.length) {
        this.remuxID3(id3Track, timeOffset);
      }
      //logger.log('nb ID3 samples:' + audioTrack.samples.length);
      if (textTrack.samples.length) {
        this.remuxText(textTrack, timeOffset);
      }
      //notify end of parsing
      this.observer.trigger(_events2.default.FRAG_PARSED);
    }
  }, {
    key: 'generateIS',
    value: function generateIS(audioTrack, videoTrack, timeOffset) {
      var observer = this.observer,
          audioSamples = audioTrack.samples,
          videoSamples = videoTrack.samples,
          typeSupported = this.typeSupported,
          container = 'audio/mp4',
          tracks = {},
          data = { tracks: tracks },
          computePTSDTS = this._initPTS === undefined,
          initPTS,
          initDTS;

      if (computePTSDTS) {
        initPTS = initDTS = Infinity;
      }
      if (audioTrack.config && audioSamples.length) {
        // let's use audio sampling rate as MP4 time scale.
        // rationale is that there is a integer nb of audio frames per audio sample (1024 for AAC)
        // using audio sampling rate here helps having an integer MP4 frame duration
        // this avoids potential rounding issue and AV sync issue
        audioTrack.timescale = audioTrack.samplerate;
        _logger.logger.log('audio sampling rate : ' + audioTrack.samplerate);
        if (!audioTrack.isAAC) {
          if (typeSupported.mpeg) {
            // Chrome and Safari
            container = 'audio/mpeg';
            audioTrack.codec = '';
          } else if (typeSupported.mp3) {
            // Firefox
            audioTrack.codec = 'mp3';
          }
        }
        tracks.audio = {
          container: container,
          codec: audioTrack.codec,
          initSegment: !audioTrack.isAAC && typeSupported.mpeg ? new Uint8Array() : _mp4Generator2.default.initSegment([audioTrack]),
          metadata: {
            channelCount: audioTrack.channelCount
          }
        };
        if (computePTSDTS) {
          // remember first PTS of this demuxing context. for audio, PTS = DTS
          initPTS = initDTS = audioSamples[0].pts - audioTrack.inputTimeScale * timeOffset;
        }
      }

      if (videoTrack.sps && videoTrack.pps && videoSamples.length) {
        // let's use input time scale as MP4 video timescale
        // we use input time scale straight away to avoid rounding issues on frame duration / cts computation
        var inputTimeScale = videoTrack.inputTimeScale;
        videoTrack.timescale = inputTimeScale;
        tracks.video = {
          container: 'video/mp4',
          codec: videoTrack.codec,
          initSegment: _mp4Generator2.default.initSegment([videoTrack]),
          metadata: {
            width: videoTrack.width,
            height: videoTrack.height
          }
        };
        if (computePTSDTS) {
          initPTS = Math.min(initPTS, videoSamples[0].pts - inputTimeScale * timeOffset);
          initDTS = Math.min(initDTS, videoSamples[0].dts - inputTimeScale * timeOffset);
          this.observer.trigger(_events2.default.INIT_PTS_FOUND, { initPTS: initPTS });
        }
      }

      if (Object.keys(tracks).length) {
        observer.trigger(_events2.default.FRAG_PARSING_INIT_SEGMENT, data);
        this.ISGenerated = true;
        if (computePTSDTS) {
          this._initPTS = initPTS;
          this._initDTS = initDTS;
        }
      } else {
        observer.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.FRAG_PARSING_ERROR, fatal: false, reason: 'no audio/video samples found' });
      }
    }
  }, {
    key: 'remuxVideo',
    value: function remuxVideo(track, timeOffset, contiguous, audioTrackLength, accurateTimeOffset) {
      var offset = 8,
          timeScale = track.timescale,
          mp4SampleDuration,
          mdat,
          moof,
          firstPTS,
          firstDTS,
          nextDTS,
          lastPTS,
          lastDTS,
          inputSamples = track.samples,
          outputSamples = [],
          nbSamples = inputSamples.length,
          ptsNormalize = this._PTSNormalize,
          initDTS = this._initDTS;

      // for (let i = 0; i < track.samples.length; i++) {
      //   let avcSample = track.samples[i];
      //   let units = avcSample.units;
      //   let unitsString = '';
      //   for (let j = 0; j < units.length ; j++) {
      //     unitsString += units[j].type + ',';
      //     if (units[j].data.length < 500) {
      //       unitsString += Hex.hexDump(units[j].data);
      //     }
      //   }
      //   logger.log(avcSample.pts + '/' + avcSample.dts + ',' + unitsString + avcSample.units.length);
      // }

      // if parsed fragment is contiguous with last one, let's use last DTS value as reference
      var nextAvcDts = this.nextAvcDts;

      var isSafari = this.isSafari;

      // Safari does not like overlapping DTS on consecutive fragments. let's use nextAvcDts to overcome this if fragments are consecutive
      if (isSafari) {
        // also consider consecutive fragments as being contiguous (even if a level switch occurs),
        // for sake of clarity:
        // consecutive fragments are frags with
        //  - less than 100ms gaps between new time offset (if accurate) and next expected PTS OR
        //  - less than 200 ms PTS gaps (timeScale/5)
        contiguous |= inputSamples.length && nextAvcDts && (accurateTimeOffset && Math.abs(timeOffset - nextAvcDts / timeScale) < 0.1 || Math.abs(inputSamples[0].pts - nextAvcDts - initDTS) < timeScale / 5);
      }

      if (!contiguous) {
        // if not contiguous, let's use target timeOffset
        nextAvcDts = timeOffset * timeScale;
      }

      // PTS is coded on 33bits, and can loop from -2^32 to 2^32
      // ptsNormalize will make PTS/DTS value monotonic, we use last known DTS value as reference value
      inputSamples.forEach(function (sample) {
        sample.pts = ptsNormalize(sample.pts - initDTS, nextAvcDts);
        sample.dts = ptsNormalize(sample.dts - initDTS, nextAvcDts);
      });

      // sort video samples by DTS then PTS then demux id order
      inputSamples.sort(function (a, b) {
        var deltadts = a.dts - b.dts;
        var deltapts = a.pts - b.pts;
        return deltadts ? deltadts : deltapts ? deltapts : a.id - b.id;
      });

      // handle broken streams with PTS < DTS, tolerance up 200ms (18000 in 90kHz timescale)
      var PTSDTSshift = inputSamples.reduce(function (prev, curr) {
        return Math.max(Math.min(prev, curr.pts - curr.dts), -18000);
      }, 0);
      if (PTSDTSshift < 0) {
        _logger.logger.warn('PTS < DTS detected in video samples, shifting DTS by ' + Math.round(PTSDTSshift / 90) + ' ms to overcome this issue');
        for (var i = 0; i < inputSamples.length; i++) {
          inputSamples[i].dts += PTSDTSshift;
        }
      }

      // compute first DTS and last DTS, normalize them against reference value
      var sample = inputSamples[0];
      firstDTS = Math.max(sample.dts, 0);
      firstPTS = Math.max(sample.pts, 0);

      // check timestamp continuity accross consecutive fragments (this is to remove inter-fragment gap/hole)
      var delta = Math.round((firstDTS - nextAvcDts) / 90);
      // if fragment are contiguous, detect hole/overlapping between fragments
      if (contiguous) {
        if (delta) {
          if (delta > 1) {
            _logger.logger.log('AVC:' + delta + ' ms hole between fragments detected,filling it');
          } else if (delta < -1) {
            _logger.logger.log('AVC:' + -delta + ' ms overlapping between fragments detected');
          }
          // remove hole/gap : set DTS to next expected DTS
          firstDTS = nextAvcDts;
          inputSamples[0].dts = firstDTS;
          // offset PTS as well, ensure that PTS is smaller or equal than new DTS
          firstPTS = Math.max(firstPTS - delta, nextAvcDts);
          inputSamples[0].pts = firstPTS;
          _logger.logger.log('Video/PTS/DTS adjusted: ' + Math.round(firstPTS / 90) + '/' + Math.round(firstDTS / 90) + ',delta:' + delta + ' ms');
        }
      }
      nextDTS = firstDTS;

      // compute lastPTS/lastDTS
      sample = inputSamples[inputSamples.length - 1];
      lastDTS = Math.max(sample.dts, 0);
      lastPTS = Math.max(sample.pts, 0, lastDTS);

      // on Safari let's signal the same sample duration for all samples
      // sample duration (as expected by trun MP4 boxes), should be the delta between sample DTS
      // set this constant duration as being the avg delta between consecutive DTS.
      if (isSafari) {
        mp4SampleDuration = Math.round((lastDTS - firstDTS) / (inputSamples.length - 1));
      }

      var nbNalu = 0,
          naluLen = 0;
      for (var _i = 0; _i < nbSamples; _i++) {
        // compute total/avc sample length and nb of NAL units
        var _sample = inputSamples[_i],
            units = _sample.units,
            nbUnits = units.length,
            sampleLen = 0;
        for (var j = 0; j < nbUnits; j++) {
          sampleLen += units[j].data.length;
        }
        naluLen += sampleLen;
        nbNalu += nbUnits;
        _sample.length = sampleLen;

        // normalize PTS/DTS
        if (isSafari) {
          // sample DTS is computed using a constant decoding offset (mp4SampleDuration) between samples
          _sample.dts = firstDTS + _i * mp4SampleDuration;
        } else {
          // ensure sample monotonic DTS
          _sample.dts = Math.max(_sample.dts, firstDTS);
        }
        // ensure that computed value is greater or equal than sample DTS
        _sample.pts = Math.max(_sample.pts, _sample.dts);
      }

      /* concatenate the video data and construct the mdat in place
        (need 8 more bytes to fill length and mpdat type) */
      var mdatSize = naluLen + 4 * nbNalu + 8;
      try {
        mdat = new Uint8Array(mdatSize);
      } catch (err) {
        this.observer.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MUX_ERROR, details: _errors.ErrorDetails.REMUX_ALLOC_ERROR, fatal: false, bytes: mdatSize, reason: 'fail allocating video mdat ' + mdatSize });
        return;
      }
      var view = new DataView(mdat.buffer);
      view.setUint32(0, mdatSize);
      mdat.set(_mp4Generator2.default.types.mdat, 4);

      for (var _i2 = 0; _i2 < nbSamples; _i2++) {
        var avcSample = inputSamples[_i2],
            avcSampleUnits = avcSample.units,
            mp4SampleLength = 0,
            compositionTimeOffset = void 0;
        // convert NALU bitstream to MP4 format (prepend NALU with size field)
        for (var _j = 0, _nbUnits = avcSampleUnits.length; _j < _nbUnits; _j++) {
          var unit = avcSampleUnits[_j],
              unitData = unit.data,
              unitDataLen = unit.data.byteLength;
          view.setUint32(offset, unitDataLen);
          offset += 4;
          mdat.set(unitData, offset);
          offset += unitDataLen;
          mp4SampleLength += 4 + unitDataLen;
        }

        if (!isSafari) {
          // expected sample duration is the Decoding Timestamp diff of consecutive samples
          if (_i2 < nbSamples - 1) {
            mp4SampleDuration = inputSamples[_i2 + 1].dts - avcSample.dts;
          } else {
            var config = this.config,
                lastFrameDuration = avcSample.dts - inputSamples[_i2 > 0 ? _i2 - 1 : _i2].dts;
            if (config.stretchShortVideoTrack) {
              // In some cases, a segment's audio track duration may exceed the video track duration.
              // Since we've already remuxed audio, and we know how long the audio track is, we look to
              // see if the delta to the next segment is longer than the minimum of maxBufferHole and
              // maxSeekHole. If so, playback would potentially get stuck, so we artificially inflate
              // the duration of the last frame to minimize any potential gap between segments.
              var maxBufferHole = config.maxBufferHole,
                  maxSeekHole = config.maxSeekHole,
                  gapTolerance = Math.floor(Math.min(maxBufferHole, maxSeekHole) * timeScale),
                  deltaToFrameEnd = (audioTrackLength ? firstPTS + audioTrackLength * timeScale : this.nextAudioPts) - avcSample.pts;
              if (deltaToFrameEnd > gapTolerance) {
                // We subtract lastFrameDuration from deltaToFrameEnd to try to prevent any video
                // frame overlap. maxBufferHole/maxSeekHole should be >> lastFrameDuration anyway.
                mp4SampleDuration = deltaToFrameEnd - lastFrameDuration;
                if (mp4SampleDuration < 0) {
                  mp4SampleDuration = lastFrameDuration;
                }
                _logger.logger.log('It is approximately ' + deltaToFrameEnd / 90 + ' ms to the next segment; using duration ' + mp4SampleDuration / 90 + ' ms for the last video frame.');
              } else {
                mp4SampleDuration = lastFrameDuration;
              }
            } else {
              mp4SampleDuration = lastFrameDuration;
            }
          }
          compositionTimeOffset = Math.round(avcSample.pts - avcSample.dts);
        } else {
          compositionTimeOffset = Math.max(0, mp4SampleDuration * Math.round((avcSample.pts - avcSample.dts) / mp4SampleDuration));
        }

        //console.log('PTS/DTS/initDTS/normPTS/normDTS/relative PTS : ${avcSample.pts}/${avcSample.dts}/${initDTS}/${ptsnorm}/${dtsnorm}/${(avcSample.pts/4294967296).toFixed(3)}');
        outputSamples.push({
          size: mp4SampleLength,
          // constant duration
          duration: mp4SampleDuration,
          cts: compositionTimeOffset,
          flags: {
            isLeading: 0,
            isDependedOn: 0,
            hasRedundancy: 0,
            degradPrio: 0,
            dependsOn: avcSample.key ? 2 : 1,
            isNonSync: avcSample.key ? 0 : 1
          }
        });
      }
      // next AVC sample DTS should be equal to last sample DTS + last sample duration (in PES timescale)
      this.nextAvcDts = lastDTS + mp4SampleDuration;
      var dropped = track.dropped;
      track.len = 0;
      track.nbNalu = 0;
      track.dropped = 0;
      if (outputSamples.length && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) {
        var flags = outputSamples[0].flags;
        // chrome workaround, mark first sample as being a Random Access Point to avoid sourcebuffer append issue
        // https://code.google.com/p/chromium/issues/detail?id=229412
        flags.dependsOn = 2;
        flags.isNonSync = 0;
      }
      track.samples = outputSamples;
      moof = _mp4Generator2.default.moof(track.sequenceNumber++, firstDTS, track);
      track.samples = [];

      var data = {
        data1: moof,
        data2: mdat,
        startPTS: firstPTS / timeScale,
        endPTS: (lastPTS + mp4SampleDuration) / timeScale,
        startDTS: firstDTS / timeScale,
        endDTS: this.nextAvcDts / timeScale,
        type: 'video',
        nb: outputSamples.length,
        dropped: dropped
      };
      this.observer.trigger(_events2.default.FRAG_PARSING_DATA, data);
      return data;
    }
  }, {
    key: 'remuxAudio',
    value: function remuxAudio(track, timeOffset, contiguous, accurateTimeOffset) {
      var inputTimeScale = track.inputTimeScale,
          mp4timeScale = track.timescale,
          scaleFactor = inputTimeScale / mp4timeScale,
          mp4SampleDuration = track.isAAC ? 1024 : 1152,
          inputSampleDuration = mp4SampleDuration * scaleFactor,
          ptsNormalize = this._PTSNormalize,
          initDTS = this._initDTS,
          rawMPEG = !track.isAAC && this.typeSupported.mpeg;

      var offset,
          mp4Sample,
          fillFrame,
          mdat,
          moof,
          firstPTS,
          lastPTS,
          inputSamples = track.samples,
          outputSamples = [],
          nextAudioPts = this.nextAudioPts;

      // for audio samples, also consider consecutive fragments as being contiguous (even if a level switch occurs),
      // for sake of clarity:
      // consecutive fragments are frags with
      //  - less than 100ms gaps between new time offset (if accurate) and next expected PTS OR
      //  - less than 20 audio frames distance
      // contiguous fragments are consecutive fragments from same quality level (same level, new SN = old SN + 1)
      // this helps ensuring audio continuity
      // and this also avoids audio glitches/cut when switching quality, or reporting wrong duration on first audio frame
      contiguous |= inputSamples.length && nextAudioPts && (accurateTimeOffset && Math.abs(timeOffset - nextAudioPts / inputTimeScale) < 0.1 || Math.abs(inputSamples[0].pts - nextAudioPts - initDTS) < 20 * inputSampleDuration);

      if (!contiguous) {
        // if fragments are not contiguous, let's use timeOffset to compute next Audio PTS
        nextAudioPts = timeOffset * inputTimeScale;
      }

      // compute normalized PTS
      inputSamples.forEach(function (sample) {
        sample.pts = sample.dts = ptsNormalize(sample.pts - initDTS, nextAudioPts);
      });

      // sort based on normalized PTS (this is to avoid sorting issues in case timestamp
      // reloop in the middle of our samples array)
      inputSamples.sort(function (a, b) {
        return a.pts - b.pts;
      });

      // If the audio track is missing samples, the frames seem to get "left-shifted" within the
      // resulting mp4 segment, causing sync issues and leaving gaps at the end of the audio segment.
      // In an effort to prevent this from happening, we inject frames here where there are gaps.
      // When possible, we inject a silent frame; when that's not possible, we duplicate the last
      // frame.

      // only inject/drop audio frames in case time offset is accurate
      if (accurateTimeOffset && track.isAAC) {
        for (var i = 0, nextPts = nextAudioPts; i < inputSamples.length;) {
          // First, let's see how far off this frame is from where we expect it to be
          var sample = inputSamples[i],
              delta;
          var pts = sample.pts;
          delta = pts - nextPts;

          var duration = Math.abs(1000 * delta / inputTimeScale);

          // If we're overlapping by more than a duration, drop this sample
          if (delta <= -inputSampleDuration) {
            _logger.logger.warn('Dropping 1 audio frame @ ' + (nextPts / inputTimeScale).toFixed(3) + 's due to ' + duration + ' ms overlap.');
            inputSamples.splice(i, 1);
            track.len -= sample.unit.length;
            // Don't touch nextPtsNorm or i
          }

          // Insert missing frames if:
          // 1: We're more than one frame away
          // 2: Not more than MAX_SILENT_FRAME_DURATION away
          // 3: currentTime (aka nextPtsNorm) is not 0
          else if (delta >= inputSampleDuration && duration < MAX_SILENT_FRAME_DURATION && nextPts) {
              var missing = Math.round(delta / inputSampleDuration);
              _logger.logger.warn('Injecting ' + missing + ' audio frame @ ' + (nextPts / inputTimeScale).toFixed(3) + 's due to ' + Math.round(1000 * delta / inputTimeScale) + ' ms gap.');
              for (var j = 0; j < missing; j++) {
                var newStamp = Math.max(nextPts, 0);
                fillFrame = _aac2.default.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);
                if (!fillFrame) {
                  _logger.logger.log('Unable to get silent frame for given audio codec; duplicating last frame instead.');
                  fillFrame = sample.unit.subarray();
                }
                inputSamples.splice(i, 0, { unit: fillFrame, pts: newStamp, dts: newStamp });
                track.len += fillFrame.length;
                nextPts += inputSampleDuration;
                i++;
              }

              // Adjust sample to next expected pts
              sample.pts = sample.dts = nextPts;
              nextPts += inputSampleDuration;
              i++;
            } else {
              // Otherwise, just adjust pts
              if (Math.abs(delta) > 0.1 * inputSampleDuration) {
                //logger.log(`Invalid frame delta ${Math.round(delta + inputSampleDuration)} at PTS ${Math.round(pts / 90)} (should be ${Math.round(inputSampleDuration)}).`);
              }
              sample.pts = sample.dts = nextPts;
              nextPts += inputSampleDuration;
              i++;
            }
        }
      }

      for (var _j2 = 0, _nbSamples = inputSamples.length; _j2 < _nbSamples; _j2++) {
        var audioSample = inputSamples[_j2];
        var unit = audioSample.unit;
        var _pts = audioSample.pts;
        //logger.log(`Audio/PTS:${Math.round(pts/90)}`);
        // if not first sample
        if (lastPTS !== undefined) {
          mp4Sample.duration = Math.round((_pts - lastPTS) / scaleFactor);
        } else {
          var _delta = Math.round(1000 * (_pts - nextAudioPts) / inputTimeScale),
              numMissingFrames = 0;
          // if fragment are contiguous, detect hole/overlapping between fragments
          // contiguous fragments are consecutive fragments from same quality level (same level, new SN = old SN + 1)
          if (contiguous && track.isAAC) {
            // log delta
            if (_delta) {
              if (_delta > 0 && _delta < MAX_SILENT_FRAME_DURATION) {
                numMissingFrames = Math.round((_pts - nextAudioPts) / inputSampleDuration);
                _logger.logger.log(_delta + ' ms hole between AAC samples detected,filling it');
                if (numMissingFrames > 0) {
                  fillFrame = _aac2.default.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);
                  if (!fillFrame) {
                    fillFrame = unit.subarray();
                  }
                  track.len += numMissingFrames * fillFrame.length;
                }
                // if we have frame overlap, overlapping for more than half a frame duraion
              } else if (_delta < -12) {
                // drop overlapping audio frames... browser will deal with it
                _logger.logger.log('drop overlapping AAC sample, expected/parsed/delta:' + (nextAudioPts / inputTimeScale).toFixed(3) + 's/' + (_pts / inputTimeScale).toFixed(3) + 's/' + -_delta + 'ms');
                track.len -= unit.byteLength;
                continue;
              }
              // set PTS/DTS to expected PTS/DTS
              _pts = nextAudioPts;
            }
          }
          // remember first PTS of our audioSamples, ensure value is positive
          firstPTS = Math.max(0, _pts);
          if (track.len > 0) {
            /* concatenate the audio data and construct the mdat in place
              (need 8 more bytes to fill length and mdat type) */
            var mdatSize = rawMPEG ? track.len : track.len + 8;
            offset = rawMPEG ? 0 : 8;
            try {
              mdat = new Uint8Array(mdatSize);
            } catch (err) {
              this.observer.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MUX_ERROR, details: _errors.ErrorDetails.REMUX_ALLOC_ERROR, fatal: false, bytes: mdatSize, reason: 'fail allocating audio mdat ' + mdatSize });
              return;
            }
            if (!rawMPEG) {
              var view = new DataView(mdat.buffer);
              view.setUint32(0, mdatSize);
              mdat.set(_mp4Generator2.default.types.mdat, 4);
            }
          } else {
            // no audio samples
            return;
          }
          for (var _i3 = 0; _i3 < numMissingFrames; _i3++) {
            fillFrame = _aac2.default.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);
            if (!fillFrame) {
              _logger.logger.log('Unable to get silent frame for given audio codec; duplicating this frame instead.');
              fillFrame = unit.subarray();
            }
            mdat.set(fillFrame, offset);
            offset += fillFrame.byteLength;
            mp4Sample = {
              size: fillFrame.byteLength,
              cts: 0,
              duration: 1024,
              flags: {
                isLeading: 0,
                isDependedOn: 0,
                hasRedundancy: 0,
                degradPrio: 0,
                dependsOn: 1
              }
            };
            outputSamples.push(mp4Sample);
          }
        }
        mdat.set(unit, offset);
        var unitLen = unit.byteLength;
        offset += unitLen;
        //console.log('PTS/DTS/initDTS/normPTS/normDTS/relative PTS : ${audioSample.pts}/${audioSample.dts}/${initDTS}/${ptsnorm}/${dtsnorm}/${(audioSample.pts/4294967296).toFixed(3)}');
        mp4Sample = {
          size: unitLen,
          cts: 0,
          duration: 0,
          flags: {
            isLeading: 0,
            isDependedOn: 0,
            hasRedundancy: 0,
            degradPrio: 0,
            dependsOn: 1
          }
        };
        outputSamples.push(mp4Sample);
        lastPTS = _pts;
      }
      var lastSampleDuration = 0;
      var nbSamples = outputSamples.length;
      //set last sample duration as being identical to previous sample
      if (nbSamples >= 2) {
        lastSampleDuration = outputSamples[nbSamples - 2].duration;
        mp4Sample.duration = lastSampleDuration;
      }
      if (nbSamples) {
        // next audio sample PTS should be equal to last sample PTS + duration
        this.nextAudioPts = nextAudioPts = lastPTS + scaleFactor * lastSampleDuration;
        //logger.log('Audio/PTS/PTSend:' + audioSample.pts.toFixed(0) + '/' + this.nextAacDts.toFixed(0));
        track.len = 0;
        track.samples = outputSamples;
        if (rawMPEG) {
          moof = new Uint8Array();
        } else {
          moof = _mp4Generator2.default.moof(track.sequenceNumber++, firstPTS / scaleFactor, track);
        }
        track.samples = [];
        var start = firstPTS / inputTimeScale;
        var end = nextAudioPts / inputTimeScale;
        var audioData = {
          data1: moof,
          data2: mdat,
          startPTS: start,
          endPTS: end,
          startDTS: start,
          endDTS: end,
          type: 'audio',
          nb: nbSamples
        };
        this.observer.trigger(_events2.default.FRAG_PARSING_DATA, audioData);
        return audioData;
      }
      return null;
    }
  }, {
    key: 'remuxEmptyAudio',
    value: function remuxEmptyAudio(track, timeOffset, contiguous, videoData) {
      var inputTimeScale = track.inputTimeScale,
          mp4timeScale = track.samplerate ? track.samplerate : inputTimeScale,
          scaleFactor = inputTimeScale / mp4timeScale,
          nextAudioPts = this.nextAudioPts,


      // sync with video's timestamp
      startDTS = (nextAudioPts !== undefined ? nextAudioPts : videoData.startDTS * inputTimeScale) + this._initDTS,
          endDTS = videoData.endDTS * inputTimeScale + this._initDTS,

      // one sample's duration value
      sampleDuration = 1024,
          frameDuration = scaleFactor * sampleDuration,


      // samples count of this segment's duration
      nbSamples = Math.ceil((endDTS - startDTS) / frameDuration),


      // silent frame
      silentFrame = _aac2.default.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);

      _logger.logger.warn('remux empty Audio');
      // Can't remux if we can't generate a silent frame...
      if (!silentFrame) {
        _logger.logger.trace('Unable to remuxEmptyAudio since we were unable to get a silent frame for given audio codec!');
        return;
      }

      var samples = [];
      for (var i = 0; i < nbSamples; i++) {
        var stamp = startDTS + i * frameDuration;
        samples.push({ unit: silentFrame, pts: stamp, dts: stamp });
        track.len += silentFrame.length;
      }
      track.samples = samples;

      this.remuxAudio(track, timeOffset, contiguous);
    }
  }, {
    key: 'remuxID3',
    value: function remuxID3(track, timeOffset) {
      var length = track.samples.length,
          sample;
      var inputTimeScale = track.inputTimeScale;
      var initPTS = this._initPTS;
      var initDTS = this._initDTS;
      // consume samples
      if (length) {
        for (var index = 0; index < length; index++) {
          sample = track.samples[index];
          // setting id3 pts, dts to relative time
          // using this._initPTS and this._initDTS to calculate relative time
          sample.pts = (sample.pts - initPTS) / inputTimeScale;
          sample.dts = (sample.dts - initDTS) / inputTimeScale;
        }
        this.observer.trigger(_events2.default.FRAG_PARSING_METADATA, {
          samples: track.samples
        });
      }

      track.samples = [];
      timeOffset = timeOffset;
    }
  }, {
    key: 'remuxText',
    value: function remuxText(track, timeOffset) {
      track.samples.sort(function (a, b) {
        return a.pts - b.pts;
      });

      var length = track.samples.length,
          sample;
      var inputTimeScale = track.inputTimeScale;
      var initPTS = this._initPTS;
      // consume samples
      if (length) {
        for (var index = 0; index < length; index++) {
          sample = track.samples[index];
          // setting text pts, dts to relative time
          // using this._initPTS and this._initDTS to calculate relative time
          sample.pts = (sample.pts - initPTS) / inputTimeScale;
        }
        this.observer.trigger(_events2.default.FRAG_PARSING_USERDATA, {
          samples: track.samples
        });
      }

      track.samples = [];
      timeOffset = timeOffset;
    }
  }, {
    key: '_PTSNormalize',
    value: function _PTSNormalize(value, reference) {
      var offset;
      if (reference === undefined) {
        return value;
      }
      if (reference < value) {
        // - 2^33
        offset = -8589934592;
      } else {
        // + 2^33
        offset = 8589934592;
      }
      /* PTS is 33bit (from 0 to 2^33 -1)
        if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
        PTS looping occured. fill the gap */
      while (Math.abs(value - reference) > 4294967296) {
        value += offset;
      }
      return value;
    }
  }]);

  return MP4Remuxer;
}();

exports.default = MP4Remuxer;