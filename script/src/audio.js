var Audio = (function(){
    var me = {};

    window.AudioContext = window.AudioContext||window.webkitAudioContext;
    window.OfflineAudioContext = window.OfflineAudioContext||window.webkitOfflineAudioContext;

    var context;
    var masterVolume;
    var cutOffVolume;
    var lowPassfilter;
    var i;
    var filterChains = [];
    var isRecording;
    var recordingAvailable;
    var mediaRecorder;
    var recordingChunks = [];
    var offlineContext;
    var currentStereoSeparation = STEREOSEPARATION.BALANCED;

    var filters = {
        volume: true,
        panning: true,
        high: true,
        mid: true,
        low: true,
        lowPass : true,
        reverb: true,
        distortion: false
    };

    var isRendering = false;

    function createAudioConnections(audioContext){

        cutOffVolume = audioContext.createGain();
        cutOffVolume.gain.setValueAtTime(1,0);
        cutOffVolume.connect(audioContext.destination);

        masterVolume = audioContext.createGain();
        masterVolume.gain.setValueAtTime(0.7,0);
        masterVolume.connect(cutOffVolume);

        lowPassfilter = audioContext.createBiquadFilter();
        lowPassfilter.type = "lowpass";
        lowPassfilter.frequency.setValueAtTime(20000,0);

        lowPassfilter.connect(masterVolume);

        me.masterVolume = masterVolume;
        me.cutOffVolume = cutOffVolume;
        me.lowPassfilter = lowPassfilter;
    }

    if (AudioContext){
        context = new AudioContext();
    }

    me.init = function(audioContext){

        audioContext = audioContext || context;
        if (!audioContext) return;

        createAudioConnections(audioContext);

        var numberOfTracks = Tracker.getTrackCount();
        filterChains = [];

        function addFilterChain(){
            var filterChain = FilterChain(filters);
            filterChain.output().connect(lowPassfilter);
            filterChains.push(filterChain);
        }

        for (i = 0; i<numberOfTracks;i++)addFilterChain();

        me.filterChains = filterChains;

        if (!isRendering){
            EventBus.on(EVENT.trackStateChange,function(state){
                if (typeof state.track != "undefined" && filterChains[state.track]){
                    filterChains[state.track].volumeValue(state.mute?0:70);
                }
            });
        }

        EventBus.on(EVENT.trackCountChange,function(trackCount){
            for (i = filterChains.length; i<trackCount;i++)addFilterChain();
            EventBus.trigger(EVENT.filterChainCountChange,trackCount);
            me.setStereoSeparation(currentStereoSeparation);
        });
    };


    me.enable = function(){
        cutOffVolume.gain.setValueAtTime(1,0);
        me.cutOff = false;
    };

    me.disable = function(){
        cutOffVolume.gain.setValueAtTime(0,0);
        me.cutOff = true;
    };

    me.checkState = function(){
        if (context){
            if (context.state === "suspended" && context.resume){
                console.warn("Audio context is suspended - trying to resume");
                context.resume();
            }
        }
    };


    me.playSample = function(index,period,volume,track,effects,time,noteIndex){

        var audioContext;
        if (isRendering){
            audioContext = offlineContext;
        }else{
            audioContext = context;
            me.enable();
        }

        if (noteIndex == 97){
            volume = 0; // note off
        }

        period = period || 428; // C-3
        track = track || Tracker.getCurrentTrack();
        time = time || 0;

        var instrument = Tracker.getInstrument(index);
        var basePeriod = period;

        if (instrument){
            var sampleBuffer;
            var offset = 0;
            var sampleLength = 0;
            var sampleLoopStart = 0;

            volume = typeof volume == "undefined" ? (100*instrument.volume/64) : volume;

            if (instrument.finetune){
                period = noteIndex ?  me.getFineTuneForNote(noteIndex,instrument.finetune) : me.getFineTuneForPeriod(period,instrument.finetune);
            }
            var sampleRate = PALFREQUENCY / (period*2);

            var initialPlaybackRate = 1;

            if (instrument.sample.data.length) {
                sampleLength = instrument.sample.data.length;
                sampleLoopStart = instrument.loopStart;
                if (effects && effects.offset){
                    if (effects.offset.value>=sampleLength) effects.offset.value = sampleLength-1;
                    offset = effects.offset.value/audioContext.sampleRate; // in seconds
                }
                // note - on safari you can't set a different samplerate?
                sampleBuffer = audioContext.createBuffer(1, sampleLength,audioContext.sampleRate);
                initialPlaybackRate = sampleRate / audioContext.sampleRate;
            }else {
                // empty samples are often used to cut of the previous instrument
                sampleBuffer = audioContext.createBuffer(1, 1, sampleRate);
                offset = 0;
            }
            var buffering = sampleBuffer.getChannelData(0);
            for(i=0; i < sampleLength; i++) {
                buffering[i] = instrument.sample.data[i];
            }

            var source = audioContext.createBufferSource();
            source.buffer = sampleBuffer;

            var volumeGain = audioContext.createGain();
            volumeGain.gain.value = volume/100;
            // TODO: volumeGain.value has no result here ?


            if (instrument.loopRepeatLength>2){

                if (!SETTINGS.unrollLoops){

                    source.loop = true;
                    // in seconds ...
                    source.loopStart = sampleLoopStart/audioContext.sampleRate;
                    source.loopEnd = (sampleLoopStart + instrument.loopRepeatLength)/audioContext.sampleRate;

                    //audioContext.sampleRate = samples/second
                }
            }

            if (instrument.volumeEnvelope && instrument.volumeEnvelope.enabled){
                var tickTime = Tracker.getProperties().tickTime;
                var volumeEnvelope = audioContext.createGain();

                // volume envelope to time ramp
                var maxPoint = instrument.volumeEnvelope.sustain ? instrument.volumeEnvelope.sustainPoint :  instrument.volumeEnvelope.count;

                volumeEnvelope.gain.value =  instrument.volumeEnvelope.points[0][1]/64;
                for (var p = 1; p<maxPoint;p++){
                    var point = instrument.volumeEnvelope.points[p];
                    volumeEnvelope.gain.linearRampToValueAtTime(point[1]/64,time + (point[0]*tickTime));
                }

                source.connect(volumeEnvelope);
                volumeEnvelope.connect(volumeGain);
            }else{
                source.connect(volumeGain);
            }

            volumeGain.connect(filterChains[track].input());

            source.playbackRate.value = initialPlaybackRate;
            var sourceDelayTime = 0;
            var playTime = time + sourceDelayTime;

            source.start(playTime,offset);

            var result = {
                source: source,
                volume: volumeGain,
                startVolume: volume,
                currentVolume: volume,
                startPeriod: period,
                basePeriod: basePeriod,
                startPlaybackRate: initialPlaybackRate,
                instrumentIndex: index,
                effects: effects,
                track: track
            };

            if (!isRendering) EventBus.trigger(EVENT.samplePlay,result);

            return result;
        }

        return {};
    };

    me.playSilence = function(){
        // used to activate Audio engine on first touch in IOS and Android devices
        if (context){
            var source = context.createBufferSource();
            source.connect(masterVolume);
            source.start();
        }
    };


    me.isRecording = function(){
        return isRecording;
    };

    me.startRecording = function(){
        if (!isRecording){

            if (context && context.createMediaStreamDestination){
                var dest = context.createMediaStreamDestination();
                mediaRecorder = new MediaRecorder(dest.stream);

                mediaRecorder.ondataavailable = function(evt) {
                    // push each chunk (blobs) in an array
                    recordingChunks.push(evt.data);
                };

                mediaRecorder.onstop = function(evt) {
                    var blob = new Blob(recordingChunks, { 'type' : 'audio/ogg; codecs=opus' });
                    saveAs(blob,"recording.opus");
                    //document.querySelector("audio").src = URL.createObjectURL(blob);
                };


                masterVolume.connect(dest);
                mediaRecorder.start();
                isRecording = true;

            }else{
                console.error("recording is not supported on this browser");
            }

        }
    };

    me.stopRecording = function(){
        if (isRecording){
            isRecording = false;
            mediaRecorder.stop();
        }
    };

    me.startRendering = function(length){
        isRendering = true;

        console.log("startRendering " + length);
        offlineContext = new OfflineAudioContext(2,44100*length,44100);
        me.context = offlineContext;
        me.init(offlineContext);
    };

    me.stopRendering = function(next){
        isRendering = false;

        offlineContext.startRendering().then(function(renderedBuffer) {
            console.log('Rendering completed successfully');
            if (next) next(audioBufferToWav(renderedBuffer));
        }).catch(function(err) {
            console.log('Rendering failed: ' + err);
            // Note: The promise should reject when startRendering is called a second time on an OfflineAudioContext
        });

        me.context = context;
        createAudioConnections(context);
        me.init(context);
    };

    me.setStereoSeparation = function(value){

        currentStereoSeparation = value;
        var numberOfTracks = Tracker.getTrackCount();

        var panAmount;
        switch(value){
            case STEREOSEPARATION.NONE:
                // mono, no panning
                panAmount = 0;
                SETTINGS.stereoSeparation = STEREOSEPARATION.NONE;
                break;
            case STEREOSEPARATION.FULL:
                // Amiga style: pan even channels hard to the left, uneven to the right;
                panAmount = 1;
                SETTINGS.stereoSeparation = STEREOSEPARATION.FULL;
                break;
            default:
                // balanced: pan even channels somewhat to the left, uneven to the right;
                panAmount = 0.5;
                SETTINGS.stereoSeparation = STEREOSEPARATION.BALANCED;
                break;
        }

        for (i = 0; i<numberOfTracks;i++){
            var filter = filterChains[i];
            if (filter) filter.panningValue(i%2==0 ? -panAmount : panAmount);
        }
    };

    me.context = context;

    function createPingPongDelay(){

        // example of delay effect.
        //Taken from http://stackoverflow.com/questions/20644328/using-channelsplitter-and-mergesplitter-nodes-in-web-audio-api

        var delayTime = 0.12;
        var feedback = 0.3;

        var merger = context.createChannelMerger(2);
        var leftDelay = context.createDelay();
        var rightDelay = context.createDelay();
        var leftFeedback = context.createGain();
        var rightFeedback = context.createGain();
        var splitter = context.createChannelSplitter(2);


        splitter.connect( leftDelay, 0 );
        splitter.connect( rightDelay, 1 );

        leftDelay.delayTime.value = delayTime;
        rightDelay.delayTime.value = delayTime;

        leftFeedback.gain.value = feedback;
        rightFeedback.gain.value = feedback;

        // Connect the routing - left bounces to right, right bounces to left.
        leftDelay.connect(leftFeedback);
        leftFeedback.connect(rightDelay);

        rightDelay.connect(rightFeedback);
        rightFeedback.connect(leftDelay);

        // Re-merge the two delay channels into stereo L/R
        leftFeedback.connect(merger, 0, 0);
        rightFeedback.connect(merger, 0, 1);

        // Now connect your input to "splitter", and connect "merger" to your output destination.

        return{
            splitter: splitter,
            merger: merger
        }
    }

    /**

     get a new AudioNode playing at x semitones from the root note
     // used to create Chords and Arpeggio

     @param {audioNode} source: audioBuffer of the root note
     @param {Number} root: period of the root note
     @param {Number} semitones: amount of semitones from the root note
     @param {Number} finetune: finetune value of the base instrument
     @return {audioNode} audioBuffer of the new note
     */
    function semiTonesFrom(source,root,semitones,finetune){
        var target;

        target = context.createBufferSource();
        target.buffer = source.buffer;

        if (semitones){
            var rootNote = periodNoteTable[root];
            var rootIndex = noteNames.indexOf(rootNote.name);
            var targetName = noteNames[rootIndex+semitones];
            if (targetName){
                var targetNote = nameNoteTable[targetName];
                if (targetNote){
                    target.playbackRate.value = (rootNote.period/targetNote.period) * source.playbackRate.value;
                }
            }
        }else{
            target.playbackRate.value = source.playbackRate.value
        }

        return target;

    }

    me.getSemiToneFrom = function(period,semitones,finetune){
        var result = period;
        if (finetune) {
            period = me.getFineTuneBasePeriod(period,finetune);
            if (!period){
                period = result;
                console.error("ERROR: base period for finetuned " + finetune + " period " + period + " not found");
            }
        }

        if (semitones){
            var rootNote = periodNoteTable[period];
            if (rootNote){
                var rootIndex = noteNames.indexOf(rootNote.name);
                var targetName = noteNames[rootIndex+semitones];
                if (targetName){
                    var targetNote = nameNoteTable[targetName];
                    if (targetNote){
                        result = targetNote.period;
                        if (finetune) {result = me.getFineTuneForPeriod(result,finetune)}
                    }
                }
            }else{
                console.error("ERROR: note for period " + period + " not found");
                // note: this can happen when the note is in a period slide
                // FIXME
            }
        }
        return result;
    };

    me.getNearestSemiTone = function(period,instrumentIndex){
        var tuning = 8;
        if (instrumenteIndex){
            var instrument = Tracker.getInstrument(instrumentIndex);
            if (instrument && instrument.finetune) tuning = tuning + instrument.finetune;
        }

        var minDelta = 100000;
        var result = period;
        for (var note in NOTEPERIOD){
            if (NOTEPERIOD.hasOwnProperty(note)){
                var p = NOTEPERIOD[note].tune[tuning];
                var delta = Math.abs(p - period);
                if (delta<minDelta) {
                    minDelta = delta;
                    result = p;
                }
            }
        }

        return result;
    };

    // gives the finetuned period for a base period
    me.getFineTuneForPeriod = function(period,finetune){
        var result = period;
        var note = periodNoteTable[period];
        if (note && note.tune){
            var centerTune = 8;
            var tune = 8 + finetune;
            if (tune>=0 && tune<note.tune.length) result = note.tune[tune];
        }

        return result;
    };

    // gives the finetuned period for a base note (Fast Tracker)
    me.getFineTuneForNote = function(note,finetune){
        //console.log("get finetune " + finetune + "  for note " + note);

        var ftNote1 = FTNotes[note];
        var ftNote2 = finetune>0 ? FTNotes[note+1] : FTNotes[note-1] ;

        if (ftNote1 && ftNote2){
            var delta = Math.abs(ftNote2.period - ftNote1.period) / 127;
            return ftNote1.period - Math.round(delta*finetune)
        }
        return ftNote1.period || 0;
    };

    // gives the non-finetuned baseperiod for a finetuned period
    me.getFineTuneBasePeriod = function(period,finetune){
        var result = period;
        var table = periodFinetuneTable[finetune];
        if (table){
            result = table[period];
        }
        return result;
    };

    me.limitAmigaPeriod = function(period){
        // limits the period to the allowed Amiga frequency range, between 113 (B3) and 856 (C1)

        period = Math.max(period,113);
        period = Math.min(period,856);

        return period;
    };

    me.setAmigaLowPassFilter = function(on,time){
        // note: this is determined by ear comparing a real Amiga 500 - maybe too much effect ?
        var value = on ? 2000 : 20000;
        lowPassfilter.frequency.setValueAtTime(value,time);
    };

    me.waveFormFunction = {
        sine: function(period,progress,freq,amp){
            return period + (Math.sin(progress * freq) * amp * 2);
        },
        saw : function(period,progress,freq,amp){
            var value = (progress * freq/7) % 1; // from 0 to 1
            value = (value * 2) - 1; // from -1 to 1
            value = value * amp * -2;
            return period + value;
        },
        square : function(period,progress,freq,amp){
            var value = Math.sin(progress * freq) <= 0 ? -1 : 1;
            value = value * amp * 2;
            return period + value;
        }
    };

    return me;

}());

