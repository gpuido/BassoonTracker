UI.OptionsPanel = function(){

	var me = UI.panel();
	me.hide();

	var background = UI.scale9Panel(0,0,20,20,UI.Assets.panelMainScale9);
	background.ignoreEvents = true;
	me.addChild(background);

	var mainLabel = UI.label({
		label: "Options:",
		font: fontMed,
		left: 5,
		height: 18,
		top: 9,
		width: 200
	});
	me.addChild(mainLabel);

	//var insetPanel = UI.scale9Panel(0,0,0,0,UI.Assets.panelInsetScale9);
	//me.addChild(insetPanel);

	var closeButton = UI.Assets.generate("button20_20");
	closeButton.setLabel("x");
	closeButton.onClick = function(){
        App.doCommand(COMMAND.showTopMain);
	};
	me.addChild(closeButton);


	var options = [
		{
			label: "Keyboard Layout:",
			values: ["QWERTY","AZERTY","QWERTZ"],
			setValue:function(index){
				if (index == 0){
					SETTINGS.keyboardTable = "qwerty";
				}if (index == 1){
					SETTINGS.keyboardTable = "azerty";
				}else{
					SETTINGS.keyboardTable = "qwertz";
				}
				Settings.saveSettings();
			},
			getValue:function(){
				var result = 0;
				if (SETTINGS.keyboardTable == "azerty") result = 1;
				if (SETTINGS.keyboardTable == "qwertz") result = 2;
				return result;
			}
		},
		{
			label: "VU bars:",
			values: ["NONE", "COLOURS: AMIGA","TRANSPARENT"],
			setValue: function (index) {
				console.error("set option " + index);
				if (index == 0){
					SETTINGS.vubars = "none";
				}else if (index == 2){
					SETTINGS.vubars = "trans";
				}else{
					SETTINGS.vubars = "colour";
				}
				Settings.saveSettings();
			},
			getValue: function () {
				var result = 1;
				if (SETTINGS.vubars == "none") result = 0;
				if (SETTINGS.vubars == "trans") result = 2;
				return result;
			}
		},
		{
			label: "Stereo:",
			values: ["Hard: Amiga", "Balanced", "None: mono"],
			setValue: function (index) {
				console.error("set option " + index);
				if (index == 0){
					Audio.setStereoSeparation(STEREOSEPARATION.FULL)
				}else if (index == 2){
					Audio.setStereoSeparation(STEREOSEPARATION.NONE)
				}
				else{
					Audio.setStereoSeparation(STEREOSEPARATION.BALANCED)
				}
				Settings.saveSettings();
			},
			getValue: function () {
				var result = 1;
				if (SETTINGS.stereoSeparation == STEREOSEPARATION.NONE) result = 2;
				if (SETTINGS.stereoSeparation == STEREOSEPARATION.FULL) result = 0;
				return result;
			}
		}
	];


	options.forEach(function(option){
		var label = UI.label();
		label.setProperties({
			label: option.label,
			font: fontFT,
			textAlign: "center"
		});
		me.addChild(label);
		option.label = label;

		var buttons = [];
		var selectedIndex = option.getValue();

		for (var i = 0; i<option.values.length; i++){
			var value = option.values[i];
			var button;
			if (value){
				button = UI.Assets.generate("buttonKey");
				button.setProperties({
					label: value
				});
				button.setActive(i==selectedIndex);
				button.index = i;
				button.option = option;
				button.onClick = function(){
					activateOption(this);
				}
			}

			me.addChild(button);
			buttons.push(button);
		}
		option.buttons = buttons;
	});

	activateOption = function(button){
		var option = button.option;

		option.buttons.forEach(function(child){
			child.setActive(false);
		});
		button.setActive(true);
		option.setValue(button.index)
	};


    me.onShow = function(){
        me.onResize();
    };

	me.onResize = function(){

        if(!me.isVisible())return;

		me.clearCanvas();

		background.setProperties({
			left: 0,
			top: 0,
			height: me.height,
			width: me.width
		});

		var startTop = 5;
		var innerHeight = me.height-(Layout.defaultMargin*2) - startTop;

		closeButton.setProperties({
			top: startTop,
			left: me.width - 30
		});

		/*insetPanel.setProperties({
			left: me.left + Layout.defaultMargin,
			top: me.top + startTop,
			height: innerHeight - 6 - mainLabel.height,
			width: me.width - (Layout.defaultMargin*2) - 4
		});*/

		var optionTop = 35;
		var optionHeight = 30;
		var buttonHeight = 20;
		var i = 0;

		options.forEach(function(option){
			var thisLeft = Layout["col3"+(i+1)+"X"];

			option.label.setProperties({
				top: optionTop,
				width: Layout.col31W,
				height: optionHeight,
				left: thisLeft
			});
			var selectedIndex = option.getValue();

			for (var b = 0; b<option.buttons.length; b++){
				var button = option.buttons[b];
				button.setProperties({
					top: optionTop + (b*buttonHeight) + 30,
					height: buttonHeight,
					width: Layout.col31W,
					left: thisLeft
				});

				button.setActive(b == selectedIndex);
			}
			i++;
		});


	};


	return me;

};

