#!/bin/bash

### initialize GPIO pins ###

init=/run/doored-init.pid
echo $$ > $init

echo "Initializing GPIO pins.."

i2c2=/sys/bus/i2c/devices/i2c-2
echo 0x20 > $i2c2/delete_device
echo pca9534 0x20 > $i2c2/new_device

sleep 1

gpio=/sys/class/gpio

gpios=(
   7 # P9.42 - ECAPPWM0 - red LED
   3 # P9.21 - EHRPWM0B - green LED
  51 # P9.16 - EHRPWM1A - blue LED

  66 # P8.7 - strike 1
  67 # P8.8 - strike 2
  69 # P8.9 - strike 3
  68 # P8.10 - strike 4
  45 # P8.11 - strike 5
  44 # P8.12 - strike 6
  23 # P8.13 - strike 7
  26 # P8.14 - strike 8

  47 # P8.15 - magnet 1
  46 # P8.16 - magnet 2
  27 # P8.17 - magnet 3
  65 # P8.18 - magnet 4
  49 # P9.23 - magnet 5
  15 # P9.24 - magnet 6
  14 # P9.26 - magnet 7

  22 # P9.19 - ds2482-800 reset

  504 # PCA9534: pin 0
  505 # PCA9534: pin 1
  506 # PCA9534: pin 2
  507 # PCA9534: pin 3
  508 # PCA9534: pin 4
  509 # PCA9534: pin 5
  510 # PCA9534: pin 6
  511 # PCA9534: pin 7
)

reset=22

for i in ${gpios[*]}; do
    dir=$gpio/gpio$i
    if [ ! -d $dir ]; then
        echo $i > $gpio/export
    fi
    echo low > $dir/direction
    chown -R door $dir $dir/
done

chown door /dev/i2c-2 /dev/watchdog* $gpio/export

sleep 1

echo high > $gpio/gpio$reset/direction

echo "GPIO initialization done."
rm $init

exit 0
