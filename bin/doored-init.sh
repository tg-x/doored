#!/bin/bash

### initialize GPIO pins ###

#i2c2=/sys/bus/i2c/devices/i2c-2
#echo 0x20 > $i2c2/delete_device
#echo pca9534 0x20 > $i2c2/new_device

gpio=/sys/class/gpio

gpios=(
   2 # P9.22 - EHRPWM0A - red LED
  22 # P8.19 - EHRPWM2A - green LED
  23 # P8.13 - EHRPWM2B - blue LED

  72 # P8.43 - strike 1
  73 # P8.44 - strike 2
  74 # P8.41 - strike 3
  75 # P8.42 - strike 4
  76 # P8.39 - strike 5
  77 # P8.40 - strike 6
  78 # P8.37 - strike 7
  79 # P8.38 - strike 8

  86 # P8.27 - magnet 1
  87 # P8.29 - magnet 2
  88 # P8.28 - magnet 3
  89 # P8.30 - magnet 4
  36 # P8.23 - magnet 5
  37 # P8.22 - magnet 6
  61 # P8.26 - magnet 7

  45 # P8.11 - ds2482 reset

#  504 # PCA9534: pin 0
#  505 # PCA9534: pin 1
#  506 # PCA9534: pin 2
#  507 # PCA9534: pin 3
#  508 # PCA9534: pin 4
#  509 # PCA9534: pin 5
#  510 # PCA9534: pin 6
#  511 # PCA9534: pin 7
)

for i in ${gpios[*]}; do
    dir=$gpio/gpio$i
    if [ ! -d $dir ]; then
        echo $i > $gpio/export
    fi
    echo low > $dir/direction
    chown -R door $dir/
done

exit 0
